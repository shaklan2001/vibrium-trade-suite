/**
 * Bounces and other mail-system messages ("Undeliverable: …" from postmaster / mailer-daemon): noise,
 * never a deal mail, never a person. Pure; client and server.
 */

/** Mail-system senders: postmaster@, mailer-daemon@, noreply@, bounces@ (any domain, ours included). */
export const SYSTEM_SENDER = /^(?:postmaster|mailer-daemon|mail-daemon|maildaemon|mailerdaemon|no-?reply|do-?not-?reply|bounces?|microsoftexchange[a-z0-9]*)@/i;

const BOUNCE_SUBJECT =
  /^\s*(?:undeliverable|undelivered mail|delivery (?:status notification|has failed|failure)|mail delivery (?:failed|failure|subsystem)|returned mail|failure notice|delivery delayed|message not delivered|non-?delivery report)\b/i;

export function isSystemSender(email: string | null | undefined): boolean {
  return SYSTEM_SENDER.test((email || "").trim());
}

/** "Name <postmaster@x>" or a bare address, plus the subject. */
export function isBounceMessage(m: { from?: string | null; subject?: string | null }): boolean {
  const from = (m.from || "").toLowerCase();
  const addr = /<([^>]+)>/.exec(from)?.[1] || from;
  if (isSystemSender(addr) || /^\s*(?:postmaster|mail delivery (?:system|subsystem)|microsoft outlook)\s*(?:<|$)/i.test(from)) return true;
  return BOUNCE_SUBJECT.test(m.subject || "");
}
