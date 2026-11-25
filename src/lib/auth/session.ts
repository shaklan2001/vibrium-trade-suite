/**
 * Admin sign-in — a JWT session cookie checked by src/middleware.ts.
 *
 * There is one account, defined entirely by env:
 *   APP_ADMIN_EMAIL     the login email (e.g. admin@snspl.in)
 *   APP_ADMIN_PASSWORD  its password
 *   APP_JWT_SECRET      signs the session JWT (32+ chars)
 *
 * Signing in issues an HS256 JWT `{ sub: email, role: "admin", iat, exp }` in an
 * HttpOnly cookie. The signing key is APP_JWT_SECRET + the password, so changing
 * the secret, the password or the email signs everyone out.
 *
 * Login is mandatory: if any of the three is missing the app fails closed
 * (pages show the sign-in screen with a setup note, /api returns 503).
 *
 * Uses Web Crypto only, so it runs in the middleware (edge) runtime and in
 * Node route handlers alike.
 */

export const SESSION_COOKIE = "vt_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AuthEnv = { email: string; password: string; secret: string };
export type SessionClaims = { sub: string; role: "admin"; iat: number; exp: number };

/** Null unless APP_ADMIN_EMAIL, APP_ADMIN_PASSWORD and APP_JWT_SECRET (32+) are all set. */
export function authEnv(): AuthEnv | null {
  const email = normalizeEmail(process.env.APP_ADMIN_EMAIL || "");
  const password = process.env.APP_ADMIN_PASSWORD || "";
  const secret = process.env.APP_JWT_SECRET?.trim() || "";
  if (!email || !password || secret.length < 32) return null;
  return { email, password, secret };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function b64urlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  let bin = "";
  for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeJson(value: unknown): string {
  return b64urlFromBytes(encoder.encode(JSON.stringify(value)));
}

function b64urlDecodeJson(part: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64urlFromBytes(await crypto.subtle.sign("HMAC", k, encoder.encode(data)));
}

/** Constant-time compare via HMAC digests (equal length, no early exit). */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const k = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
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

/** Checks both fields in constant time (no early exit on a wrong email). */
export async function checkCredentials(
  email: string,
  password: string,
  env: AuthEnv,
): Promise<boolean> {
  const [emailOk, passwordOk] = await Promise.all([
    timingSafeEqualStr(normalizeEmail(email), env.email),
    timingSafeEqualStr(password, env.password),
  ]);
  return emailOk && passwordOk;
}

const JWT_HEADER = b64urlEncodeJson({ alg: "HS256", typ: "JWT" });

export async function signSessionJwt(env: AuthEnv): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { sub: env.email, role: "admin", iat, exp: iat + SESSION_TTL_SEC };
  const unsigned = `${JWT_HEADER}.${b64urlEncodeJson(claims)}`;
  return `${unsigned}.${await hmacSha256(signingKey(env), unsigned)}`;
}

/** Returns the claims of a valid, unexpired token for the current admin, else null. */
export async function verifySessionJwt(
  token: string | undefined,
  env: AuthEnv,
): Promise<SessionClaims | null> {
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  // Only accept exactly our header — rejects alg:none and alg swaps.
  if (header !== JWT_HEADER) return null;
  const expected = await hmacSha256(signingKey(env), `${header}.${payload}`);
  if (!(await timingSafeEqualStr(signature, expected))) return null;

  const claims = b64urlDecodeJson(payload) as Partial<SessionClaims> | null;
  if (!claims || typeof claims.exp !== "number" || typeof claims.sub !== "string") return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (claims.sub !== env.email || claims.role !== "admin") return null;
  return claims as SessionClaims;
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
