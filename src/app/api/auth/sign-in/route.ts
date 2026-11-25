import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authEnv,
  checkCredentials,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  signSessionJwt,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/auth/sign-in { email, password } — checks the admin credentials
 * from env and sets the JWT session cookie. Public (see middleware).
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "sign-in", 10, 60_000);
  if (limited) return limited;

  const env = authEnv();
  if (!env) {
    return NextResponse.json(
      { error: "Sign-in is not configured on this server" },
      { status: 503, headers: NO_STORE },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; password?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.slice(0, 320) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 1024) : "";
  if (!email || !password || !(await checkCredentials(email, password, env))) {
    return NextResponse.json(
      { error: "Wrong email or password" },
      { status: 401, headers: NO_STORE },
    );
  }

  const res = NextResponse.json({ ok: true, email: env.email }, { headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, await signSessionJwt(env), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
