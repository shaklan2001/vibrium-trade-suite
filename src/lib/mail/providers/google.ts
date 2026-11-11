import { googleOAuthConfig } from "../config";
import type { MailSecret } from "../types";
import { fetchWithRetry, MailAuthError, postForm, readJson } from "./http";
import type { OAuthIdentity, OpenSession, ProviderRef } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export function googleAuthUrl(state: string, redirectUri: string) {
  const { clientId } = googleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // consent forces a refresh_token even on re-connect
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

function toSecret(tok: TokenResponse, prev?: MailSecret): MailSecret {
  return {
    kind: "oauth",
    access_token: tok.access_token,
    refresh_token:
      tok.refresh_token || (prev?.kind === "oauth" ? prev.refresh_token : undefined),
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
    scope: tok.scope,
  };
}

export async function googleExchangeCode(
  code: string,
  redirectUri: string,
): Promise<OAuthIdentity> {
  const { clientId, clientSecret } = googleOAuthConfig();
  const tok = await postForm<TokenResponse>(
    TOKEN_URL,
    {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    },
    "Google token exchange",
  );
  if (!tok.refresh_token) {
    throw new Error("Google did not return a refresh token — remove the app at myaccount.google.com/permissions and connect again");
  }
  if (!(tok.scope || "").includes("gmail.readonly")) {
    throw new Error("Gmail read permission was not granted — tick the Gmail checkbox on the consent screen");
  }
  const secret = toSecret(tok);
  const profile = await readJson<{ emailAddress: string }>(
    await fetchWithRetry(`${GMAIL}/profile`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }),
    "Gmail profile",
  );
  let displayName: string | null = null;
  try {
    const info = await readJson<{ name?: string }>(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }),
      "Google userinfo",
    );
    displayName = info.name || null;
  } catch {
    // name is cosmetic
  }
  return { email: profile.emailAddress.toLowerCase(), displayName, secret };
}

export async function googleRefresh(secret: MailSecret): Promise<MailSecret> {
  if (secret.kind !== "oauth" || !secret.refresh_token) {
    throw new MailAuthError("Google connection has no refresh token");
  }
  const { clientId, clientSecret } = googleOAuthConfig();
  try {
    const tok = await postForm<TokenResponse>(
      TOKEN_URL,
      {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: secret.refresh_token,
        grant_type: "refresh_token",
      },
      "Google token refresh",
    );
    return toSecret(tok, secret);
  } catch (err) {
    if (err instanceof MailAuthError) {
      throw new MailAuthError(
        "Google access expired or was revoked — click Reconnect. (While the Google OAuth app is in Testing mode, Google ends access after 7 days.)",
      );
    }
    throw err;
  }
}

export async function googleRevoke(secret: MailSecret) {
  if (secret.kind !== "oauth") return;
  const token = secret.refresh_token || secret.access_token;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch(() => undefined);
}

/** users.watch → Pub/Sub push. Returns expiry (≤ 7 days). */
export async function googleWatch(secret: MailSecret, topicName: string) {
  if (secret.kind !== "oauth") throw new Error("not oauth");
  const res = await fetchWithRetry(`${GMAIL}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret.access_token}`,
      "Content-Type": "application/json",
    },
    // No label filter: a push only triggers a sync, which skips spam/trash/drafts itself.
    body: JSON.stringify({ topicName }),
  });
  const body = await readJson<{ historyId: string; expiration: string }>(res, "Gmail watch");
  return {
    historyId: body.historyId,
    expires: new Date(Number(body.expiration)).toISOString(),
  };
}

export async function googleStopWatch(secret: MailSecret) {
  if (secret.kind !== "oauth") return;
  await fetch(`${GMAIL}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret.access_token}` },
  }).catch(() => undefined);
}

export async function freshGoogleSecret(secret: MailSecret) {
  if (secret.kind !== "oauth") throw new MailAuthError("Google connection is missing OAuth tokens");
  if (secret.expires_at && secret.expires_at > Date.now() + 120_000) {
    return { secret, changed: false };
  }
  return { secret: await googleRefresh(secret), changed: true };
}

export const openGoogleSession: OpenSession = async (_conn, initial) => {
  const { secret, changed } = await freshGoogleSecret(initial);
  const token = secret.kind === "oauth" ? secret.access_token : "";
  const headers = { Authorization: `Bearer ${token}` };

  return {
    secret,
    secretChanged: changed,
    async listSince(since, cap) {
      const refs: ProviderRef[] = [];
      const q = `after:${Math.floor(since.getTime() / 1000)} -in:drafts -in:chats`;
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({ q, maxResults: "500" });
        if (pageToken) params.set("pageToken", pageToken);
        const body = await readJson<{
          messages?: { id: string }[];
          nextPageToken?: string;
        }>(await fetchWithRetry(`${GMAIL}/messages?${params}`, { headers }), "Gmail list");
        for (const m of body.messages || []) refs.push({ id: m.id });
        pageToken = body.nextPageToken;
      } while (pageToken && refs.length < cap);
      // Gmail lists newest first; process oldest first so threads build in order.
      return refs.slice(0, cap).reverse();
    },
    async fetchRaw(ref) {
      const res = await fetchWithRetry(`${GMAIL}/messages/${ref.id}?format=raw`, { headers });
      if (res.status === 404) return null;
      const body = await readJson<{ raw?: string; labelIds?: string[] }>(res, "Gmail get");
      const labels = body.labelIds || [];
      if (labels.some((l) => l === "SPAM" || l === "TRASH" || l === "DRAFT")) return null;
      return body.raw ? Buffer.from(body.raw, "base64url") : null;
    },
    async close() {},
  };
};
