import { microsoftOAuthConfig } from "../config";
import type { MailSecret } from "../types";
import { fetchWithRetry, MailAuthError, postForm, readJson } from "./http";
import type { OAuthIdentity, OpenSession, ProviderRef } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "profile",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.Read",
];

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

function authority() {
  return `https://login.microsoftonline.com/${microsoftOAuthConfig().tenant}/oauth2/v2.0`;
}

export function microsoftAuthUrl(state: string, redirectUri: string) {
  const { clientId } = microsoftOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    prompt: "select_account",
    state,
  });
  return `${authority()}/authorize?${params}`;
}

function toSecret(tok: TokenResponse, prev?: MailSecret): MailSecret {
  return {
    kind: "oauth",
    access_token: tok.access_token,
    // Microsoft rotates refresh tokens — always keep the newest.
    refresh_token:
      tok.refresh_token || (prev?.kind === "oauth" ? prev.refresh_token : undefined),
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
    scope: tok.scope,
  };
}

export async function microsoftExchangeCode(
  code: string,
  redirectUri: string,
): Promise<OAuthIdentity> {
  const { clientId, clientSecret } = microsoftOAuthConfig();
  const tok = await postForm<TokenResponse>(
    `${authority()}/token`,
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: MICROSOFT_SCOPES.join(" "),
    },
    "Microsoft token exchange",
  );
  if (!tok.refresh_token) throw new Error("Microsoft did not return a refresh token (offline_access)");
  const me = await readJson<{ mail?: string; userPrincipalName?: string; displayName?: string }>(
    await fetchWithRetry(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }),
    "Graph /me",
  );
  const email = (me.mail || me.userPrincipalName || "").toLowerCase();
  if (!email) throw new Error("Could not read the mailbox address from Microsoft Graph");
  return { email, displayName: me.displayName || null, secret: toSecret(tok) };
}

export async function microsoftRefresh(secret: MailSecret): Promise<MailSecret> {
  if (secret.kind !== "oauth" || !secret.refresh_token) {
    throw new MailAuthError("Microsoft connection has no refresh token");
  }
  const { clientId, clientSecret } = microsoftOAuthConfig();
  const tok = await postForm<TokenResponse>(
    `${authority()}/token`,
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: secret.refresh_token,
      grant_type: "refresh_token",
      scope: MICROSOFT_SCOPES.join(" "),
    },
    "Microsoft token refresh",
  );
  return toSecret(tok, secret);
}

export async function freshMicrosoftSecret(secret: MailSecret) {
  if (secret.kind !== "oauth") throw new MailAuthError("Microsoft connection is missing OAuth tokens");
  if (secret.expires_at && secret.expires_at > Date.now() + 120_000) {
    return { secret, changed: false };
  }
  return { secret: await microsoftRefresh(secret), changed: true };
}

/** Graph mail subscriptions live ≤ 4230 minutes; we renew well before that. */
const SUBSCRIPTION_MINUTES = 4000;

export async function microsoftSubscribe(
  secret: MailSecret,
  notificationUrl: string,
  clientState: string,
) {
  if (secret.kind !== "oauth") throw new Error("not oauth");
  const expires = new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();
  const body = await readJson<{ id: string; expirationDateTime: string }>(
    await fetchWithRetry(`${GRAPH}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        changeType: "created",
        notificationUrl,
        resource: "me/messages",
        expirationDateTime: expires,
        clientState,
      }),
    }),
    "Graph subscribe",
  );
  return { id: body.id, expires: body.expirationDateTime };
}

export async function microsoftRenew(secret: MailSecret, subscriptionId: string) {
  if (secret.kind !== "oauth") throw new Error("not oauth");
  const expires = new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();
  const res = await fetchWithRetry(`${GRAPH}/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${secret.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expirationDateTime: expires }),
  });
  if (res.status === 404) return null;
  const body = await readJson<{ expirationDateTime: string }>(res, "Graph renew");
  return { id: subscriptionId, expires: body.expirationDateTime };
}

export async function microsoftUnsubscribe(secret: MailSecret, subscriptionId: string) {
  if (secret.kind !== "oauth") return;
  await fetch(`${GRAPH}/subscriptions/${subscriptionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret.access_token}` },
  }).catch(() => undefined);
}

export const openMicrosoftSession: OpenSession = async (_conn, initial) => {
  const { secret, changed } = await freshMicrosoftSecret(initial);
  const token = secret.kind === "oauth" ? secret.access_token : "";
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  async function folderId(wellKnown: string) {
    try {
      const body = await readJson<{ id: string }>(
        await fetchWithRetry(`${GRAPH}/me/mailFolders/${wellKnown}?$select=id`, { headers }),
        `Graph folder ${wellKnown}`,
      );
      return body.id;
    } catch (err) {
      if (err instanceof MailAuthError) throw err;
      return null;
    }
  }

  return {
    secret,
    secretChanged: changed,
    async listSince(since, cap) {
      const skip = new Set(
        (await Promise.all([folderId("junkemail"), folderId("deleteditems"), folderId("drafts")])).filter(
          Boolean,
        ) as string[],
      );
      const refs: ProviderRef[] = [];
      const params = new URLSearchParams({
        $filter: `receivedDateTime ge ${since.toISOString()}`,
        $orderby: "receivedDateTime asc",
        $select: "id,receivedDateTime,isDraft,parentFolderId",
        $top: "200",
      });
      let url: string | undefined = `${GRAPH}/me/messages?${params}`;
      while (url && refs.length < cap) {
        const body: {
          value?: { id: string; receivedDateTime?: string; isDraft?: boolean; parentFolderId?: string }[];
          "@odata.nextLink"?: string;
        } = await readJson(await fetchWithRetry(url, { headers }), "Graph list");
        for (const m of body.value || []) {
          if (m.isDraft || (m.parentFolderId && skip.has(m.parentFolderId))) continue;
          refs.push({ id: m.id, date: m.receivedDateTime });
        }
        url = body["@odata.nextLink"];
      }
      return refs.slice(0, cap);
    },
    async fetchRaw(ref) {
      const res = await fetchWithRetry(`${GRAPH}/me/messages/${encodeURIComponent(ref.id)}/$value`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return null;
      if (res.status === 401) throw new MailAuthError("Graph: unauthorized");
      if (!res.ok) throw new Error(`Graph $value failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async close() {},
  };
};
