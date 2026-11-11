/** Server-only env for live mailbox connections. */

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

/** Shared secret for Vercel Cron and external pingers (Bearer or ?token=…). */
export function mailCronSecret(): string {
  return env("CRON_SECRET");
}

/**
 * Mail server for team mailboxes, decided on the backend: mail.<email domain>
 * on IMAP 993 / SMTP 465 — exactly SNSPL's cPanel (mail.snspl.in). The browser
 * never chooses a host. MAIL_IMAP_HOST / _PORT and MAIL_SMTP_HOST / _PORT
 * override it only if the mail host ever moves.
 */
export function mailServerFor(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  const imapHost = env("MAIL_IMAP_HOST") || (domain ? `mail.${domain}` : "");
  const imapPort = Number(env("MAIL_IMAP_PORT")) || 993;
  const smtpPort = Number(env("MAIL_SMTP_PORT")) || 465;
  return {
    imap: { host: imapHost, port: imapPort, secure: imapPort === 993 },
    // 465 = TLS from the start; 587/25 upgrade with STARTTLS.
    smtp: { host: env("MAIL_SMTP_HOST") || imapHost, port: smtpPort, secure: smtpPort === 465 },
  };
}

/** Only mailboxes on MAIL_WORKSPACE_DOMAIN (snspl.in) may be connected. */
export function allowedMailDomains(): string[] {
  const own = env("MAIL_WORKSPACE_DOMAIN").toLowerCase();
  return own ? [own] : [];
}

export const MAIL_LIMITS = {
  /** Messages fetched + parsed per connection per run. */
  messagesPerRun: Number(env("MAIL_MESSAGES_PER_RUN") || 150),
  /** IDs listed per run (paging stops here). */
  listCap: 5000,
  /** New worker executions started per run. */
  jobsPerRun: Number(env("MAIL_JOBS_PER_RUN") || 10),
  /** The shared inbox wants all mail: a year by default, up to ten. */
  defaultBackfillDays: Number(env("MAIL_DEFAULT_BACKFILL_DAYS") || 365),
  maxBackfillDays: 3650,
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
