/**
 * Team sign-in session — a signed, expiring cookie checked by src/middleware.ts.
 *
 * The app has one shared team password (APP_ACCESS_PASSWORD). Signing in sets
 * an HttpOnly cookie `<expiresAtSec>.<hmac>` where the HMAC key is
 * APP_SESSION_SECRET + the password, so rotating either one signs everyone out.
 *
 * Uses Web Crypto only, so it runs in the middleware (edge) runtime and in
 * Node route handlers alike.
 */

export const SESSION_COOKIE = "vt_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

type AuthEnv = { secret: string; password: string };

/** Null when sign-in is not configured — callers must then fail closed. */
export function authEnv(): AuthEnv | null {
  const secret = process.env.APP_SESSION_SECRET?.trim() || "";
  const password = process.env.APP_ACCESS_PASSWORD || "";
  if (secret.length < 32 || !password) return null;
  return { secret, password };
}

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", k, encoder.encode(data)));
}

/** Constant-time compare via HMAC digests (equal length, no early exit). */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", k, encoder.encode(a)),
    crypto.subtle.sign("HMAC", k, encoder.encode(b)),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

function signingKey(env: AuthEnv): string {
  return `${env.secret}\u0000${env.password}`;
}

export async function createSessionValue(env: AuthEnv): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  return `${exp}.${await hmac(signingKey(env), `v1.${exp}`)}`;
}

export async function verifySessionValue(
  value: string | undefined,
  env: AuthEnv,
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expRaw = value.slice(0, dot);
  if (!/^\d{1,12}$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (exp <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(signingKey(env), `v1.${exp}`);
  return timingSafeEqualStr(value.slice(dot + 1), expected);
}

/**
 * Optional machine credential for local scripts (scripts/eval-copilot*.ts,
 * scripts/extract-deal-documents.mjs): `Authorization: Bearer $APP_API_TOKEN`.
 * Unset = no bearer access.
 */
export async function verifyApiToken(header: string | null): Promise<boolean> {
  const token = process.env.APP_API_TOKEN?.trim() || "";
  if (token.length < 32 || !header) return false;
  return timingSafeEqualStr(header, `Bearer ${token}`);
}

/** Only same-site relative paths, so `?next=` can't redirect off-site. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/home";
  }
  return next;
}
