import { NextResponse, type NextRequest } from "next/server";
import { authEnv, SESSION_COOKIE, verifySessionJwt } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me — who is signed in. Behind the middleware, so 401 without a session. */
export async function GET(req: NextRequest) {
  const env = authEnv();
  const claims = env ? await verifySessionJwt(req.cookies.get(SESSION_COOKIE)?.value, env) : null;
  if (!claims) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { email: claims.sub, role: claims.role, expiresAt: claims.exp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
