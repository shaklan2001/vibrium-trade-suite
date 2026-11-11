/** Shared shapes for team mailbox connections (IMAP to read, SMTP to send). */

/** SNSPL mailboxes are cPanel-hosted: IMAP to read, SMTP to send. */
export type MailProviderId = "imap";

export type MailConnectionStatus =
  | "active"
  | "paused"
  | "error"
  | "reauth_required";

/** strict = same relevance rules as the PST pipeline; all = let the worker gate decide. */
export type MailFilterMode = "trade" | "all";

export type MailConnectionSettings = {
  backfill_days?: number;
  filter_mode?: MailFilterMode;
  imap?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
  };
  /** Outgoing server for IMAP mailboxes (replies from the inbox). Same login as IMAP. */
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
  };
};

export type MailConnectionCursor = {
  /** Everything received before this instant has been listed and stored. */
  synced_through?: string;
};

/** Decrypted secret payload — never leaves the server. */
export type MailSecret = { kind: "password"; password: string };

/** Row as stored (secret still encrypted). */
export type MailConnectionRow = {
  id: string;
  provider: MailProviderId;
  email: string;
  display_name: string | null;
  status: MailConnectionStatus;
  secret_enc: string;
  settings_json: MailConnectionSettings;
  cursor_json: MailConnectionCursor;
  last_sync_at: string | null;
  last_error: string | null;
  created_at?: string;
  updated_at?: string;
};

/** What the browser is allowed to see. */
export type MailConnectionPublic = Omit<
  MailConnectionRow,
  "secret_enc" | "cursor_json"
> & {
  synced_through: string | null;
  stats?: MailConnectionStats;
};

export type MailConnectionStats = {
  messages: number;
  ingested: number;
  noise: number;
  deals: number;
  last_message_at: string | null;
};

export type StoredAttachment = {
  name: string;
  sha256: string;
  size: number;
  content_type: string;
  ext: string;
  /** S3 key under AWS_S3_PREFIX/{sha256}/{file} — same store as PST ingest. */
  s3_key?: string;
  inline?: boolean;
  /** Not uploaded (inline image, too large, …). */
  skipped?: string;
};

export type MailMessageStatus = "ingested" | "noise" | "error";

export type StoredMailMessage = {
  connection_id: string;
  provider_message_id: string;
  internet_message_id: string | null;
  in_reply_to: string | null;
  references_json: string[];
  deal_key: string | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  to_text: string | null;
  cc_text: string | null;
  sent_at: string | null;
  body_text: string | null;
  attachments_json: StoredAttachment[];
  status: MailMessageStatus;
  role: string | null;
  /** Conversation key — see threadKeyFor() in ./thread. */
  thread_key?: string | null;
  /** IMAP folder the copy came from. */
  folder?: MailFolder | null;
  created_at?: string;
};

export type MailFolder = "inbox" | "sent";

/** One conversation on an inbox page (keyset cursor = last_at + thread_key). */
export type InboxThreadRow = { thread_key: string; last_at: string; message_count: number };

/** Message as the inbox reads it from the store (body clipped on list pages). */
export type InboxMessageRow = Omit<StoredMailMessage, "references_json" | "created_at">;

export type InboxPage = { threads: InboxThreadRow[]; messages: InboxMessageRow[]; has_more: boolean };

/** Message list row for the UI — no body. */
export type MailMessageSummary = Omit<StoredMailMessage, "body_text"> & {
  job_status: string | null;
  job_error: string | null;
};

export type MailDealJobStatus =
  | "pending"
  | "starting"
  | "running"
  | "done"
  | "skipped"
  | "failed";

export type MailDealJob = {
  deal_key: string;
  status: MailDealJobStatus;
  dirty: boolean;
  execution_id: string | null;
  agent_id: string | null;
  slot: string | null;
  pack_json: Record<string, unknown> | null;
  attempts: number;
  last_error: string | null;
  started_at: string | null;
  updated_at?: string;
};
