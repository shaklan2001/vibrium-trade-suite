import type { MailProviderId } from "./types";

/** Server-only env for live mailbox connections. */

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

/**
 * Production URL registered with Google (OAuth redirect URI, authorised domain,
 * homepage + privacy policy on the consent screen). Keep in sync with
 * docs/GOOGLE_OAUTH_VERIFICATION.md.
 */
export const PRODUCTION_SITE_URL = "https://vibrium-trade-suite.vercel.app";

export function mailRedirectBase(requestOrigin?: string): string {
  return (
    env("MAIL_OAUTH_REDIRECT_BASE") ||
    env("NEXT_PUBLIC_SITE_URL") ||
    // Production is pinned so a deploy reached via another alias still sends
    // Google the one redirect URI that is registered.
    (env("VERCEL_ENV") === "production" ? PRODUCTION_SITE_URL : "") ||
    requestOrigin ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function oauthRedirectUri(
  provider: "google" | "microsoft",
  requestOrigin?: string,
) {
  return `${mailRedirectBase(requestOrigin)}/api/mail/oauth/${provider}/callback`;
}

export function googleOAuthConfig() {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    /** projects/{project}/topics/{topic} — optional; enables Gmail push. */
    pubsubTopic: env("GOOGLE_PUBSUB_TOPIC"),
  };
}

export function microsoftOAuthConfig() {
  return {
    clientId: env("MICROSOFT_CLIENT_ID"),
    clientSecret: env("MICROSOFT_CLIENT_SECRET"),
    tenant: env("MICROSOFT_TENANT_ID") || "common",
  };
}

export function providerConfigured(provider: MailProviderId): boolean {
  if (provider === "google") {
    const c = googleOAuthConfig();
    return Boolean(c.clientId && c.clientSecret);
  }
  if (provider === "microsoft") {
    const c = microsoftOAuthConfig();
    return Boolean(c.clientId && c.clientSecret);
  }
  return true;
}

/** Shared secret used by Vercel Cron and push webhooks (?token=…). */
export function mailCronSecret(): string {
  return env("CRON_SECRET") || env("MAIL_CRON_SECRET");
}

/** Push webhooks need a public HTTPS URL the provider can reach. */
export function pushWebhookBase(): string | null {
  const base = mailRedirectBase();
  if (!base.startsWith("https://")) return null;
  if (!mailCronSecret()) return null;
  return base;
}

export const MAIL_LIMITS = {
  /** Messages fetched + parsed per connection per run. */
  messagesPerRun: Number(env("MAIL_MESSAGES_PER_RUN") || 150),
  /** IDs listed per run (paging stops here). */
  listCap: 2000,
  /** New worker executions started per run. */
  jobsPerRun: Number(env("MAIL_JOBS_PER_RUN") || 10),
  defaultBackfillDays: Number(env("MAIL_DEFAULT_BACKFILL_DAYS") || 30),
  maxBackfillDays: 365,
  /** Re-list a window behind the cursor so late-indexed mail is not missed. */
  overlapMs: 2 * 60 * 60 * 1000,
  bodyChars: 20_000,
  attachmentMaxBytes: 20 * 1024 * 1024,
  rawMaxBytes: 35 * 1024 * 1024,
};

/** Comma-separated extra domains so non-SNSPL mailboxes classify parties too. */
export function extraDomains(name: string): string[] {
  return env(name)
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
