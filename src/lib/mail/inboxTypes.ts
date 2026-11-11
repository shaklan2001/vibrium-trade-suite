/** Shapes for the agent inbox (read the mail → draft the reply). Client-safe. */

/** What the inbox needs from a person for this mail. */
export type InboxOutcome = "draft_ready" | "needs_you" | "waiting" | "replied" | "fyi";

export const INBOX_OUTCOME_ORDER: InboxOutcome[] = [
  "draft_ready",
  "needs_you",
  "waiting",
  "replied",
  "fyi",
];

export const INBOX_OUTCOME_LABELS: Record<InboxOutcome, string> = {
  draft_ready: "Draft ready",
  needs_you: "Needs you",
  waiting: "Waiting on them",
  replied: "Replied",
  fyi: "FYI",
};

export type InboxMessage = {
  id: string;
  from: string;
  fromName: string;
  to: string;
  cc: string;
  date: string | null;
  subject: string;
  /** Newest text only — quoted history stripped. */
  body: string;
  attachments: string[];
  /** Sent by our side (SNSPL / the connected mailbox). */
  internal: boolean;
};

export type InboxFact = { label: string; value: string };

export type ReplyDraft = {
  to: string;
  toName: string;
  subject: string;
  body: string;
  by: "template" | "copilot";
};

export type InboxItem = {
  /** processed_deals id (po:… / topic:…). */
  id: string;
  subject: string;
  /** The mail the inbox shows: newest message from the other side. */
  latest: InboxMessage;
  /** Oldest → newest, capped. */
  thread: InboxMessage[];
  outcome: InboxOutcome;
  /** Why a person has to look (needs_you) or what we're waiting for. */
  note: string | null;
  stage: string | null;
  slot: string | null;
  agentName: string;
  agentId: string | null;
  summary: string | null;
  confidence: number | null;
  facts: InboxFact[];
  poNumbers: string[];
  /** Our person who signs the reply. */
  signer: string;
  draft: ReplyDraft | null;
  /** processed_deals id when the thread is linked to a deal in the book. */
  dealId?: string | null;
  /** Where `latest` lives — the mailbox a reply is sent from. */
  mailbox: InboxMailboxRef;
};

export type InboxMailboxRef = {
  connectionId: string;
  mailboxEmail: string;
  mailboxName: string | null;
  /** Sync ref of `latest` (imap:<folder>:<uidvalidity>:<uid>). */
  messageId: string;
  internetMessageId: string | null;
  threadKey: string;
};

/** A connected team mailbox (shared workspace — everyone sees every mailbox). */
export type InboxMailbox = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

/** Keyset cursor: the last conversation of the previous page. */
export type InboxCursor = { at: string; key: string };
