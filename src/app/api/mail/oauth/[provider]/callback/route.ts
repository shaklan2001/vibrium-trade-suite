import { after, NextRequest, NextResponse } from "next/server";
import { deadlineIn } from "@/lib/mail/api";
import { MAIL_LIMITS, mailRedirectBase, oauthRedirectUri } from "@/lib/mail/config";
import { connectionId, encryptSecret, safeEqual, verifyState } from "@/lib/mail/crypto";
import { googleExchangeCode } from "@/lib/mail/providers/google";
import { microsoftExchangeCode } from "@/lib/mail/providers/microsoft";
import { getMailStore } from "@/lib/mail/store";
import { runMailCycle } from "@/lib/mail/sync";
import type { MailConnectionRow, MailFilterMode } from "@/lib/mail/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s; work is chunked (MAIL_REQUEST_BUDGET_S).
export const maxDuration = 60;

const OAUTH_COOKIE = "vt_mail_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

type State = { p: string; n: string; t: number; b?: number; f?: MailFilterMode };

/**
 * The common ways sign-in fails for accounts inside vs outside our Google
 * Workspace — turned into something a user (or their admin) can act on.
 */
function friendlyDenial(provider: string, code: string, description: string | null) {
  if (provider === "google") {
    if (code === "access_denied") {
      return "Google sign-in was cancelled or blocked. Outside the workspace: ask us to add you as a test user. Company Google account: your Workspace admin may need to allow this app (Admin console → Security → API controls).";
    }
    if (code === "admin_policy_enforced") {
      return "Your Google Workspace admin blocks this app. They can allow it under Admin console → Security → API controls → App access control.";
    }
    if (code === "org_internal") {
      return "This app only accepts accounts from our own Google Workspace. Set the OAuth consent screen to External to let outside accounts connect.";
    }
  }
  return (description || code).slice(0, 200);
}

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/mailbox/connections", mailRedirectBase(req.nextUrl.origin));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/mail/oauth" });
  return res;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") {
    return back(req, { error: "Unknown provider" });
  }
  const sp = req.nextUrl.searchParams;
  const deniedCode = sp.get("error");
  if (deniedCode) {
    return back(req, { error: friendlyDenial(provider, deniedCode, sp.get("error_description")) });
  }

  const code = sp.get("code");
  const state = verifyState<State>(sp.get("state") || "");
  const nonce = req.cookies.get(OAUTH_COOKIE)?.value || "";
  if (
    !code ||
    !state ||
    state.p !== provider ||
    !nonce ||
    !safeEqual(state.n, nonce) ||
    Date.now() - state.t > STATE_TTL_MS
  ) {
    return back(req, { error: "Sign-in expired or was tampered with — please try again" });
  }

  try {
    const redirectUri = oauthRedirectUri(provider, req.nextUrl.origin);
    const identity =
      provider === "google"
        ? await googleExchangeCode(code, redirectUri)
        : await microsoftExchangeCode(code, redirectUri);

    const store = getMailStore();
    const id = connectionId(provider, identity.email);
    const prev = await store.getConnection(id);
    const row: MailConnectionRow = {
      id,
      provider,
      email: identity.email,
      display_name: identity.displayName,
      status: "active",
      secret_enc: encryptSecret(identity.secret),
      settings_json: {
        ...(prev?.settings_json || {}),
        backfill_days:
          state.b || prev?.settings_json.backfill_days || MAIL_LIMITS.defaultBackfillDays,
        filter_mode: state.f || prev?.settings_json.filter_mode || "trade",
      },
      cursor_json: prev?.cursor_json || {},
      last_sync_at: prev?.last_sync_at || null,
      last_error: null,
    };
    await store.saveConnection(row);

    // Initial backfill + push registration continue after the redirect.
    after(() =>
      runMailCycle({ connectionId: id, push: true, deadline: deadlineIn() }).catch(console.error),
    );
    return back(req, { connected: identity.email });
  } catch (err) {
    console.error("[mail/oauth] callback failed", err);
    return back(req, { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
  }
}
