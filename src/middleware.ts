import { NextResponse, type NextRequest } from "next/server";
import {
  authEnv,
  SESSION_COOKIE,
  verifyApiToken,
  verifySessionJwt,
} from "@/lib/auth/session";

/**
 * One gate for the whole app — always on. Every app page and /api route needs
 * a valid admin JWT session cookie (or the APP_API_TOKEN bearer for local
 * scripts on /api). Pages without one redirect to /sign-in; /api returns 401.
 * If sign-in isn't configured (APP_ADMIN_EMAIL, APP_ADMIN_PASSWORD,
 * APP_JWT_SECRET) it fails closed. Only the routes below are public.
 */

/** API routes reachable without a session — each must say why. */
const PUBLIC_API = new Set([
  // Signing in is how you get a session.
  "/api/auth/sign-in",
  // Only clears the cookie; must work after the session has expired.
  "/api/auth/sign-out",
  // Called by Vercel Cron (no cookie). The route checks CRON_SECRET itself
  // and returns 401 without it (src/app/api/mail/cron/route.ts).
  "/api/mail/cron",
  // Machine-only (scripts/extract-deal-documents.mjs, no UI caller). The route
  // requires `Authorization: Bearer $CRON_SECRET` itself and returns 401 without it.
  "/api/processed-deals/documents",
]);

/** Pages that are public: marketing, legal pages the mail providers link to, sign-in. */
const PUBLIC_PAGES = new Set(["/", "/privacy", "/terms", "/sign-in"]);

/** Files served from /public (svg icons, /geo/countries-110m.json). Never /api. */
const STATIC_FILE = /\.(?:svg|png|jpe?g|gif|webp|ico|txt|xml|webmanifest|json)$/i;

function json(status: number, error: string) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const env = authEnv();

  // Already signed in? Skip the sign-in screen.
  if (pathname === "/sign-in") {
    if (env && (await verifySessionJwt(req.cookies.get(SESSION_COOKIE)?.value, env))) {
      return NextResponse.redirect(new URL("/home", req.url));
    }
    return NextResponse.next();
  }

  if (isApi ? PUBLIC_API.has(pathname) : PUBLIC_PAGES.has(pathname)) {
    return NextResponse.next();
  }
  if (!isApi && STATIC_FILE.test(pathname)) return NextResponse.next();

  if (!env) {
    // Not configured: fail closed. /sign-in explains what to set.
    if (isApi) {
      return json(503, "Sign-in is not configured (APP_ADMIN_EMAIL, APP_ADMIN_PASSWORD, APP_JWT_SECRET)");
    }
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const signedIn =
    (await verifySessionJwt(req.cookies.get(SESSION_COOKIE)?.value, env)) !== null ||
    (isApi && (await verifyApiToken(req.headers.get("authorization"))));
  if (signedIn) return NextResponse.next();

  if (isApi) return json(401, "Unauthorized");

  const to = new URL("/sign-in", req.url);
  to.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(to);
}

export const config = {
  // Everything except Next's own build assets. /api/* is always included.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
