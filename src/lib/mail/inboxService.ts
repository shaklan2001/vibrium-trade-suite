import { decryptSecret } from "./crypto";
import { replyThroughImap } from "./imapMailbox";
import { buildInboxItem, itemContext } from "./inboxItems";
import type { InboxCursor, InboxItem, InboxMailbox } from "./inboxTypes";
import { MailAuthError } from "./providers/http";
import { getMailStore } from "./store";
import { threadKeyFor } from "./thread";
import type { InboxMessageRow, MailConnectionRow } from "./types";

/**
 * The shared team inbox. Reads come from the synced store (every connected
 * mailbox, kept current by the background sync), so a page is one query no
 * matter how many mailboxes are connected; replies go out through the
 * mailbox's own IMAP/SMTP login.
 *
 *   IMAP ──sync──▶ mail_messages ──▶ inboxPage / thread ──▶ /mailbox/inbox
 *                        ▲                                       │
 *                        └──── sent reply row ◀── SMTP send ◀────┘
 */

export type ReplyMode = "send" | "draft";

export class MailboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "not_found" | "reauth_required" | "bad_request",
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

const PAGE_DEFAULT = 40;
const THREAD_LIMIT = 30;

function publicMailbox(c: MailConnectionRow): InboxMailbox {
  return {
    id: c.id,
    email: c.email,
    displayName: c.display_name,
    status: c.status,
    lastSyncAt: c.last_sync_at,
    lastError: c.last_error,
  };
}

/** Every connected team mailbox (shared workspace). */
export async function listMailboxes(): Promise<{ rows: MailConnectionRow[]; mailboxes: InboxMailbox[] }> {
  const rows = (await getMailStore().listConnections()).filter((c) => c.provider === "imap");
  rows.sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));
  return { rows, mailboxes: rows.map(publicMailbox) };
}

async function dealsFor(rows: InboxMessageRow[]) {
  const ids = [...new Set(rows.map((r) => r.deal_key).filter((k): k is string => Boolean(k)))];
  if (!ids.length) return [];
  return getMailStore().dealsByIds(ids).catch(() => []);
}

function groupByThread(rows: InboxMessageRow[]) {
  const out = new Map<string, InboxMessageRow[]>();
  for (const r of rows) {
    const key = r.thread_key || r.internet_message_id || r.provider_message_id;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(r);
  }
  for (const list of out.values()) list.sort((a, b) => (a.sent_at || "").localeCompare(b.sent_at || ""));
  return out;
}

/** One page of conversations for one mailbox or all of them, newest first. */
export async function loadInboxPage(opts: {
  mailbox: string;
  before?: InboxCursor | null;
  q?: string;
  limit?: number;
}): Promise<{ mailboxes: InboxMailbox[]; items: InboxItem[]; nextCursor: InboxCursor | null }> {
  const { rows, mailboxes } = await listMailboxes();
  const scope = opts.mailbox === "all" ? rows : rows.filter((r) => r.id === opts.mailbox);
  if (!scope.length) {
    if (opts.mailbox !== "all") throw new MailboxError("This mailbox is no longer connected.", 404, "not_found");
    return { mailboxes, items: [], nextCursor: null };
  }
  const page = await getMailStore().inboxPage({
    connectionIds: scope.map((r) => r.id),
    limit: Math.min(Math.max(opts.limit || PAGE_DEFAULT, 1), 60),
    q: opts.q?.trim().slice(0, 120) || undefined,
    before: opts.before || null,
  });
  const ctx = itemContext(rows, await dealsFor(page.messages));
  const byThread = groupByThread(page.messages);
  const items = page.threads
    .map((t) => buildInboxItem(t.thread_key, byThread.get(t.thread_key) || [], ctx))
    .filter((i): i is InboxItem => Boolean(i));
  const last = page.threads[page.threads.length - 1];
  return {
    mailboxes,
    items,
    nextCursor: page.has_more && last ? { at: new Date(last.last_at).toISOString(), key: last.thread_key } : null,
  };
}

/**
 * The whole conversation (full bodies, every mailbox that has a copy — so a
 * colleague's reply shows too). Used when a mail is opened and drafted.
 */
export async function loadThread(threadKey: string): Promise<InboxItem | null> {
  const { rows } = await listMailboxes();
  if (!rows.length) return null;
  const messages = await getMailStore().threadMessages({
    connectionIds: rows.map((r) => r.id),
    threadKey,
    limit: THREAD_LIMIT,
  });
  const ctx = itemContext(rows, await dealsFor(messages));
  return buildInboxItem(threadKey, messages, ctx);
}

async function markReauth(conn: MailConnectionRow, message: string) {
  await getMailStore()
    .saveConnection({ ...conn, status: "reauth_required", last_error: message.slice(0, 500) })
    .catch(() => undefined);
}

/**
 * Send (or save to Drafts) a reply from the mailbox that holds the mail. A
 * sent reply is written to the store straight away so the thread shows it
 * and the conversation moves to "Replied" — even for users whose Outlook
 * keeps Sent Items only on their PC.
 */
export async function replyFromMailbox(opts: {
  connectionId: string;
  messageId: string;
  internetMessageId?: string | null;
  body: string;
  mode: ReplyMode;
  draftId?: string;
}) {
  const store = getMailStore();
  const conn = await store.getConnection(opts.connectionId);
  if (!conn || conn.provider !== "imap") throw new MailboxError("This mailbox is no longer connected.", 404, "not_found");
  const secret = decryptSecret(conn.secret_enc);

  let result;
  try {
    result = await replyThroughImap(conn, secret.password, opts);
  } catch (err) {
    if (err instanceof MailAuthError) {
      await markReauth(conn, err.message);
      throw new MailboxError(
        `The mail server rejected the password for ${conn.email} — reconnect it on Email connections.`,
        401,
        "reauth_required",
      );
    }
    throw err;
  }
  if (result.notFound) {
    throw new MailboxError(`The original mail is no longer in ${conn.email} (deleted?).`, 404, "not_found");
  }
  if (result.mode === "draft") {
    return { mode: result.mode, mailbox: conn.email, draftId: result.draftId };
  }

  const { reply } = result;
  const dealKey = opts.internetMessageId
    ? ((await store.dealKeysForMessageIds([opts.internetMessageId]).catch(() => ({}))) as Record<string, string>)[
        opts.internetMessageId
      ] || null
    : null;
  await store
    .insertMessages([
      {
        connection_id: conn.id,
        provider_message_id: `sent:${reply.messageId}`,
        internet_message_id: reply.messageId,
        in_reply_to: opts.internetMessageId || null,
        references_json: opts.internetMessageId ? [opts.internetMessageId] : [],
        deal_key: dealKey,
        subject: reply.subject,
        from_email: conn.email,
        from_name: conn.display_name,
        to_text: reply.to,
        cc_text: null,
        sent_at: new Date().toISOString(),
        body_text: reply.text,
        attachments_json: [],
        status: dealKey ? "ingested" : "noise",
        role: "internal",
        thread_key: threadKeyFor(reply.subject, reply.messageId),
        folder: "sent",
      },
    ])
    .catch((err) => console.warn("[mail/reply] could not record the sent reply", err));
  return { mode: result.mode, mailbox: conn.email, draftId: null };
}
