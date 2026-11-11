import type { MailProviderId } from "../types";
import { openGoogleSession } from "./google";
import { openImapSession } from "./imap";
import { openMicrosoftSession } from "./microsoft";
import type { OpenSession } from "./types";

export const PROVIDER_SESSIONS: Record<MailProviderId, OpenSession> = {
  google: openGoogleSession,
  microsoft: openMicrosoftSession,
  imap: openImapSession,
};

export const PROVIDER_LABELS: Record<MailProviderId, string> = {
  google: "Gmail / Google Workspace",
  microsoft: "Outlook / Microsoft 365",
  imap: "IMAP",
};

export { MailAuthError } from "./http";
