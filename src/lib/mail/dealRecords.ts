/**
 * Small per-deal records kept in mail_records:
 *   deal_note     what the team knows from calls and chats (not in any email)
 *   notification  an in-app message for the person who owns the order (payment arrived, …)
 *
 * Notes feed Copilot, reply drafts and the next-action agent. Server only.
 */
import { createHash, randomUUID } from "node:crypto";
import type { MailRecord, MailStore } from "./store";

const OURS = /@snspl\.(in|ml)$/i;
const SHARED = /^(accounts|occ|info|admin|noreply|no-reply)@/i;

export type DealNote = { id: string; dealKey: string; author: string; text: string; createdAt: string };

export type Notification = {
  id: string;
  owner: string;
  kind: "payment";
  title: string;
  body: string;
  href: string;
  dealKey: string | null;
  createdAt: string;
  readAt: string | null;
};

const noteOf = (r: MailRecord): DealNote => ({
  id: r.id,
  dealKey: r.dealKey || "",
  author: String(r.data.author || "team"),
  text: String(r.data.text || ""),
  createdAt: r.createdAt,
});

export async function addDealNote(store: MailStore, input: { dealKey: string; author: string; text: string }): Promise<DealNote> {
  const text = input.text.trim().slice(0, 2000);
  if (!input.dealKey || !text) throw new Error("dealKey and text are required");
  const author = input.author.trim().slice(0, 80) || "team";
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await store.upsertRecords([{ kind: "deal_note", id, dealKey: input.dealKey, owner: null, data: { author, text }, createdAt }]);
  return { id, dealKey: input.dealKey, author, text, createdAt };
}

export async function listDealNotes(store: MailStore, dealKey: string, limit = 20): Promise<DealNote[]> {
  // Notes from an off-mail update that was undone stay in the table but are not shown or used.
  const rows = await store.listRecords({ kind: "deal_note", dealKey, limit: limit + 10 });
  return rows.filter((r) => !r.data.voidedAt).slice(0, limit).map(noteOf);
}

/** Newest notes as one line each, for the reply prompt, Copilot and the next-action brief. */
export async function noteTextsFor(store: MailStore, dealKey: string, limit = 5): Promise<string[]> {
  const notes = await listDealNotes(store, dealKey, limit).catch(() => []);
  return notes.map((n) => `${n.createdAt.slice(0, 10)} ${n.author}: ${n.text}`);
}

/** The SNSPL person who handles a deal: the busiest of our senders, shared mailboxes excluded. */
export async function dealOwner(store: MailStore, dealKey: string): Promise<string | null> {
  const rows = await store.messagesForDeal(dealKey, 200);
  const counts = new Map<string, number>();
  for (const m of rows) {
    const from = (m.from_email || "").toLowerCase();
    if (OURS.test(from) && !SHARED.test(from)) counts.set(from, (counts.get(from) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const notificationOf = (r: MailRecord): Notification => ({
  id: r.id,
  owner: r.owner || "",
  kind: "payment",
  title: String(r.data.title || ""),
  body: String(r.data.body || ""),
  href: String(r.data.href || ""),
  dealKey: r.dealKey,
  createdAt: r.createdAt,
  readAt: typeof r.data.readAt === "string" ? r.data.readAt : null,
});

const PAYMENT_LABEL: Record<string, string> = {
  payment_received: "Payment received",
  payment_sent: "Payment sent by the payer",
  payment_request: "Payment requested",
};

/** One notification per payment email and owner (re-reading the same email does not repeat it). */
export async function notifyPayment(
  store: MailStore,
  p: { entryId: string; dealKey: string | null; kind: string | null; amount: number | null; currency: string | null; summary: string | null; href: string },
): Promise<boolean> {
  if (!p.dealKey || !p.kind || p.kind === "other") return false;
  const owner = await dealOwner(store, p.dealKey);
  if (!owner) return false;
  const id = createHash("sha1").update(`${p.entryId}|${owner}`).digest("hex").slice(0, 24);
  const existing = await store.listRecords({ kind: "notification", owner, limit: 500 });
  if (existing.some((r) => r.id === id)) return false;
  const money = p.amount != null ? `${p.currency || ""} ${p.amount.toLocaleString("en-US")}`.trim() : "amount not stated";
  await store.upsertRecords([
    { kind: "notification", id, dealKey: p.dealKey, owner, data: { title: `${PAYMENT_LABEL[p.kind] || "Payment"} · ${money}`, body: p.summary || "", href: p.href } },
  ]);
  return true;
}

export async function listNotifications(store: MailStore, owner: string | null, limit = 50): Promise<Notification[]> {
  const rows = await store.listRecords({ kind: "notification", owner: owner || undefined, limit });
  return rows.map(notificationOf);
}

export async function markNotificationRead(store: MailStore, id: string, owner: string): Promise<boolean> {
  const rows = await store.listRecords({ kind: "notification", owner, limit: 500 });
  const hit = rows.find((r) => r.id === id);
  if (!hit) return false;
  await store.upsertRecords([{ kind: "notification", id, dealKey: hit.dealKey, owner, data: { ...hit.data, readAt: new Date().toISOString() }, createdAt: hit.createdAt }]);
  return true;
}
