import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import type { MailSecret } from "./types";

/**
 * AES-256-GCM for OAuth tokens / IMAP passwords at rest.
 * MAIL_ENCRYPTION_KEY can be any high-entropy string (we SHA-256 it to 32 bytes).
 */
function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 16) {
    throw new Error(
      "MAIL_ENCRYPTION_KEY is not set (min 16 chars) — required to store mailbox credentials",
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(secret: MailSecret): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(secret), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(value: string): MailSecret {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body) {
    throw new Error("Unrecognised secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const text = Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(text) as MailSecret;
}

function hmac(data: string): string {
  return createHmac("sha256", key()).update(data).digest("base64url");
}

/** Signed, expiring OAuth `state` (CSRF) bound to a nonce cookie. */
export function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyState<T = Record<string, unknown>>(
  state: string,
): T | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function connectionId(provider: string, email: string): string {
  return `mc_${createHash("sha256")
    .update(`${provider}:${email.toLowerCase()}`)
    .digest("hex")
    .slice(0, 20)}`;
}
