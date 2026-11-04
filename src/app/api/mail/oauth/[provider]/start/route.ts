import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError } from "@/lib/mail/api";
import { oauthRedirectUri, providerConfigured } from "@/lib/mail/config";
import { randomToken, signState } from "@/lib/mail/crypto";
import { googleAuthUrl } from "@/lib/mail/providers/google";
import { microsoftAuthUrl } from "@/lib/mail/providers/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Must match the callback route.
const OAUTH_COOKIE = "vt_mail_oauth";

/** GET /api/mail/oauth/{google|microsoft}/start?backfill_days=30&filter_mode=trade */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const limited = checkRateLimit(req, "mail-oauth", 20, 60_000);
  if (limited) return limited;
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") return jsonError("Unknown provider", 404);
  if (!providerConfigured(provider)) {
    return jsonError(
      `${provider === "google" ? "GOOGLE" : "MICROSOFT"}_CLIENT_ID / _CLIENT_SECRET are not set`,
      503,
    );
  }
  try {
    const nonce = randomToken();
    const sp = req.nextUrl.searchParams;
    const state = signState({
      p: provider,
      n: nonce,
      t: Date.now(),
      b: Number(sp.get("backfill_days")) || undefined,
      f: sp.get("filter_mode") === "all" ? "all" : "trade",
    });
    const redirectUri = oauthRedirectUri(provider, req.nextUrl.origin);
    const url =
      provider === "google" ? googleAuthUrl(state, redirectUri) : microsoftAuthUrl(state, redirectUri);
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(OAUTH_COOKIE, nonce, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/mail/oauth",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
