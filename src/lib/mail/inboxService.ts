import { decryptSecret } from "./crypto";
import { isBounceMessage } from "./bounce";
import { ensureLearnedRoles } from "./learnedRolesStore";
import { noteTextsFor } from "./dealRecords";
import type { NextActionState } from "./nextAction";
import { docTextsFor, type StoredFile } from "./docStore";
import { DOC_TYPE_LABELS } from "./docText";
import { replyThroughImap } from "./imapMailbox";
import { buildInboxItem, itemContext } from "./inboxItems";
import type { InboxCursor, InboxDocument, InboxItem, InboxMailbox } from "./inboxTypes";
import { MailAuthError } from "./providers/http";
import { getMailStore } from "./store";
import { threadKeyFor } from "./thread";
import { isDead, withinYear } from "./viewWindow";
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
  await ensureLearnedRoles({ ownEmails: rows.map((c) => c.email) });
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
  // One-year view: threads arrive newest first, so the first one outside the year ends the list.
  const { kept, done } = withinYear(page.threads);
  // Bounces ("Undeliverable: RE: …" from postmaster) are noise: a thread of only bounces drops out.
  const messages = page.messages.filter((m) => !isBounceMessage({ from: m.from_email, subject: m.subject }));
  const ctx = itemContext(rows, await dealsFor(messages));
  const byThread = groupByThread(messages);
  const lastAt = new Map(kept.map((t) => [t.thread_key, t.last_at]));
  const items = await withNextActions(
    await withPayments(
      kept
        .map((t) => buildInboxItem(t.thread_key, byThread.get(t.thread_key) || [], ctx))
        .filter((i): i is InboxItem => Boolean(i))
        // Dead: quiet for 6 months. Hidden from the list, not deleted.
        .filter((i) => !isDead(lastAt.get(i.mailbox.threadKey) || Date.now())),
      byThread,
    ),
  );
  const last = page.threads[page.threads.length - 1];
  return {
    mailboxes,
    items,
    nextCursor: !done && page.has_more && last ? { at: new Date(last.last_at).toISOString(), key: last.thread_key } : null,
  };
}

/**
 * The whole conversation (full bodies, every mailbox that has a copy — so a
 * colleague's reply shows too). Used when a mail is opened and drafted.
 */
export async function loadThread(threadKey: string): Promise<InboxItem | null> {
  const { rows } = await listMailboxes();
  if (!rows.length) return null;
  const all = await getMailStore().threadMessages({
    connectionIds: rows.map((r) => r.id),
    threadKey,
    limit: THREAD_LIMIT,
  });
  // Bounces are hidden in a conversation; a link straight to a bounce-only thread still opens.
  const real = all.filter((m) => !isBounceMessage({ from: m.from_email, subject: m.subject }));
  const messages = real.length ? real : all;
  const ctx = itemContext(rows, await dealsFor(messages));
  const item = buildInboxItem(threadKey, messages, ctx);
  if (!item) return null;
  const [withPay] = await withNextActions(await withPayments([item], new Map([[threadKey, messages]])));
  const notes = withPay!.dealId ? await noteTextsFor(getMailStore(), withPay!.dealId, 5).catch(() => []) : [];
  return { ...withPay!, notes, documents: await threadDocuments(messages) };
}

/** Attach the agent's next step to each conversation that belongs to a deal. */
async function withNextActions(items: InboxItem[]): Promise<InboxItem[]> {
  if (!items.some((i) => i.dealId)) return items;
  const records = await getMailStore()
    .listRecords({ kind: "next_action", limit: 5000 })
    .catch(() => []);
  const byDeal = new Map(records.map((r) => [r.id, r.data as unknown as NextActionState]));
  return items.map((item) => {
    const state = item.dealId ? byDeal.get(item.dealId) : undefined;
    if (state?.status !== "done" || !state.result) return item;
    const { action, owner, to, due, basedOn } = state.result;
    return { ...item, nextAction: { action, owner, to, due, basedOn } };
  });
}

/** Text of the thread's files for the draft: newest mail from the other side first, at most 4 files. */
async function threadDocuments(rows: InboxMessageRow[]): Promise<InboxDocument[]> {
  const theirs = [...rows].reverse().find((m) => !/@snspl\.(in|ml)$/i.test(m.from_email || ""));
  const ordered = theirs ? [theirs, ...[...rows].reverse().filter((m) => m !== theirs)] : [...rows].reverse();
  const files = ordered.flatMap((m) => ((m.attachments_json || []) as StoredFile[]).map((f) => ({ f, onLatest: m === theirs })));
  const texts = await docTextsFor(files.map((x) => x.f), 4).catch(() => []);
  return texts.map((d) => ({
    name: d.name,
    type: DOC_TYPE_LABELS[d.docType],
    text: d.text.length > 2500 ? `${d.text.slice(0, 2500)}\n…` : d.text,
    onLatest: files.some((x) => x.onLatest && x.f.name === d.name),
  }));
}

const OWNER_SKIP = /^(accounts|occ|info|admin|noreply|no-reply)@/i;

/** Tag conversations that hold a payment email (read by the Payment Reader) with amount, POs and the order's owner. */
async function withPayments(items: InboxItem[], byThread: Map<string, InboxMessageRow[]>): Promise<InboxItem[]> {
  const ids = items.flatMap((i) => (byThread.get(i.mailbox.threadKey) || []).map((m) => m.internet_message_id || m.provider_message_id));
  if (!ids.length) return items;
  const paid = await getMailStore()
    .listPayments({ ids, status: "done", limit: ids.length })
    .catch(() => []);
  if (!paid.length) return items;
  const byId = new Map(paid.map((p) => [p.id, p]));
  return items.map((item) => {
    const rows = byThread.get(item.mailbox.threadKey) || [];
    const hit = [...rows].reverse().map((m) => byId.get(m.internet_message_id || m.provider_message_id)).find(Boolean);
    if (!hit || !hit.kind || hit.kind === "other") return item;
    const counts = new Map<string, number>();
    for (const m of rows) {
      const from = (m.from_email || "").toLowerCase();
      if (/@snspl\.(in|ml)$/.test(from) && !OWNER_SKIP.test(from)) counts.set(from, (counts.get(from) || 0) + 1);
    }
    const owner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      ...item,
      payment: {
        kind: hit.kind,
        amount: hit.amount,
        currency: hit.currency,
        pos: [...new Set(hit.allocations.map((a) => a.po).filter((p): p is string => Boolean(p)))].slice(0, 6),
        summary: hit.summary,
        owner,
      },
    };
  });
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
