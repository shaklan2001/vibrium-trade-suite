import type { MailProviderId } from "../types";
import { openImapSession } from "./imap";
import type { OpenSession } from "./types";

/** SNSPL mail is hosted on cPanel, so every mailbox connects over IMAP/SMTP. */
export const PROVIDER_SESSIONS: Record<MailProviderId, OpenSession> = {
  imap: openImapSession,
};

export const PROVIDER_LABELS: Record<MailProviderId, string> = {
  imap: "IMAP / SMTP",
};

export { MailAuthError } from "./http";
