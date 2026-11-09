import type { MailFolder } from "./types";

/**
 * Conversation grouping for the shared inbox. Outlook-style: replies and
 * forwards share the subject once "Re:/Fw:" prefixes are stripped. The SQL
 * backfill in infra/trade-suite-rds-proxy/handler.py (_migrate_mail) uses the
 * same rule — keep them in step.
 */
export function threadKeyFor(subject: string | null | undefined, fallbackId: string) {
  const key = (subject || "")
    .trim()
    .replace(/^((re|fw|fwd|aw|sv)\s*:\s*)+/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return key || fallbackId;
}

/** IMAP ref ids look like imap:<path>:<uidvalidity>:<uid>; anything not INBOX is Sent. */
export function folderForRef(refId: string): MailFolder {
  const path = decodeURIComponent(refId.split(":")[1] || "");
  return path.toUpperCase() === "INBOX" ? "inbox" : "sent";
}
