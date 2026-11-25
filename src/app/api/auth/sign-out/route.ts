import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/sign-out — clears the session cookie. Public (see middleware). */
export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  // Clear the old readable marker left by the previous password-only sign-in.
  res.cookies.set("vt_signed_in", "", { path: "/", maxAge: 0 });
  return res;
}
