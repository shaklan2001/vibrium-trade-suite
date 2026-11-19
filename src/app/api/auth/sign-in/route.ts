import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authEnv,
  createSessionValue,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  timingSafeEqualStr,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/auth/sign-in { password } — sets the team session cookie. Public (see middleware). */
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

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !(await timingSafeEqualStr(password, env.password))) {
    return NextResponse.json(
      { error: "Wrong password" },
      { status: 401, headers: NO_STORE },
    );
  }

  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, await createSessionValue(env), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
