/**
 * Next action on every deal, read from all of its threads by a worker agent (Trade Next Action),
 * and a log of whether the action was taken.
 *
 *   mail_records kind=next_action      id = deal key; data = { status, executionId, brief, result… }
 *   mail_records kind=next_action_log  id = `${dealKey}:${createdAt}`; data = { action, doneAt, messageId… }
 *
 * Flow per mail cycle (same shape as the payment reader): deals with new mail are queued, queued
 * deals get a brief (newest mails across threads, open items, payments, team notes) and a run,
 * finished runs are saved. When our side sends a mail that carries out the action, the log row is
 * closed. Everything fails soft. Server only.
 */
import { computeDealSignals } from "./signalStore";
import { freshText } from "./inbox";
import { mailRef } from "./mailLink";
import type { MailRecord, MailStore } from "./store";
import { executionResult, getExecution, startExecution, TERMINAL } from "./workers";

export type NextAction = {
  action: string;
  /** SNSPL person who should do it. */
  owner: string | null;
  /** Party the action is for (buyer, factory, forwarder, a name). */
  to: string | null;
  due: string | null;
  /** Message ids (refs) the action rests on. */
  basedOn: string[];
  confidence: number | null;
};

export type NextActionState = {
  status: "pending" | "running" | "done" | "failed";
  executionId?: string | null;
  startedAt?: string | null;
  error?: string | null;
  result?: NextAction | null;
  /** When the result was saved. */
  readAt?: string | null;
};

const READ_TIMEOUT_MS = 10 * 60_000;
const OURS = /@snspl\.(in|ml)$/i;

export function nextActionAgentId() {
  return process.env.VIBRIUM_NEXT_ACTION_AGENT_ID || "";
}

const stateOf = (r: MailRecord) => r.data as unknown as NextActionState;

/** The model's output as a NextAction; null when it names no action. */
export function parseNextAction(raw: Record<string, unknown> | null): NextAction | null {
  if (!raw) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 400) : null);
  const action = text(raw.action);
  if (!action) return null;
  const basedOn = Array.isArray(raw.based_on) ? raw.based_on.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  const confidence = typeof raw.confidence === "number" ? raw.confidence : null;
  return { action, owner: text(raw.owner), to: text(raw.to), due: text(raw.due), basedOn, confidence };
}

/** What the agent reads: newest mails across all threads, open items, payments, team notes. */
export async function nextActionBrief(store: MailStore, dealKey: string): Promise<string> {
  const rows = await store.messagesForDeal(dealKey, 60);
  const seen = new Set<string>();
  const mails = rows
    .filter((m) => m.sent_at)
    .filter((m) => {
      const id = m.internet_message_id || m.provider_message_id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => (a.sent_at || "").localeCompare(b.sent_at || ""))
    .slice(-14);
  const lines = mails.map((m) => {
    const id = m.internet_message_id || m.provider_message_id;
    const side = OURS.test(m.from_email || "") ? "SNSPL" : "THEM";
    const files = (m.attachments_json || []).filter((a) => !a.inline).map((a) => a.name).slice(0, 4);
    return `[${mailRef(id)}] ${new Date(m.sent_at!).toISOString().slice(0, 10)} ${side} ${m.from_name || m.from_email} — ${m.subject || ""}\n${freshText(m.body_text || "", m.subject || "").slice(0, 700)}${files.length ? `\n(attachments: ${files.join(", ")})` : ""}`;
  });
  const signals = await computeDealSignals(dealKey, store).catch(() => []);
  const open = signals.map((s) => `- ${s.kind}: ${s.party} — "${s.quote}" (since ${s.since.slice(0, 10)}) [${mailRef(s.messageId)}]`);
  const notes = (await store.listRecords({ kind: "deal_note", dealKey, limit: 5 }).catch(() => []))
    .map((n) => `- ${String(n.data.author || "team")}: ${String(n.data.text || "")}`);
  return [
    `Deal ${dealKey}. Today is ${new Date().toISOString().slice(0, 10)}.`,
    "Emails across all threads, oldest to newest (the id in brackets is what you cite in based_on):",
    lines.join("\n\n") || "(no emails)",
    open.length ? `Open items already detected:\n${open.join("\n")}` : "",
    notes.length ? `Team notes (calls and chats, not in the emails):\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Put deals with new mail in the queue (replaces an older result; it is re-read). */
export async function queueNextActions(store: MailStore, dealKeys: string[]): Promise<number> {
  if (!nextActionAgentId()) return 0;
  const keys = [...new Set(dealKeys.filter(Boolean))].slice(0, 100);
  if (!keys.length) return 0;
  const existing = new Map((await store.listRecords({ kind: "next_action", limit: 5000 })).map((r) => [r.id, r]));
  const rows = keys
    .filter((k) => stateOf(existing.get(k) || ({ data: {} } as MailRecord)).status !== "running")
    .map((k) => {
      const prev = existing.get(k);
      const data: NextActionState = { ...(prev ? stateOf(prev) : {}), status: "pending", error: null };
      return { kind: "next_action" as const, id: k, dealKey: k, data: data as unknown as Record<string, unknown>, createdAt: prev?.createdAt };
    });
  if (rows.length) await store.upsertRecords(rows);
  return rows.length;
}

/** Finish running reads, start queued ones. */
export async function processNextActions(store: MailStore, opts: { deadline: number; limit?: number }) {
  const out = { finished: 0, started: 0, failed: 0 };
  const agentId = nextActionAgentId();
  if (!agentId) return out;
  const records = await store.listRecords({ kind: "next_action", limit: 5000 });
  for (const r of records.filter((x) => stateOf(x).status === "running").slice(0, 40)) {
    if (Date.now() > opts.deadline) return out;
    const state = stateOf(r);
    try {
      const ex = await getExecution(state.executionId || "");
      if (!TERMINAL.has(ex.status || "")) {
        if (Date.now() - Date.parse(state.startedAt || "") < READ_TIMEOUT_MS) continue;
      }
      const result = ex.status === "completed" ? parseNextAction(executionResult(ex)) : null;
      const next: NextActionState = result
        ? { status: "done", result, readAt: new Date().toISOString(), executionId: state.executionId }
        : { status: "failed", error: `agent ${ex.status || "timed out"}`.slice(0, 200), executionId: state.executionId };
      await store.upsertRecords([{ kind: "next_action", id: r.id, dealKey: r.dealKey, data: next as unknown as Record<string, unknown>, createdAt: r.createdAt }]);
      if (result) {
        const at = new Date().toISOString();
        await store.upsertRecords([
          { kind: "next_action_log", id: `${r.id}:${at}`, dealKey: r.dealKey, owner: result.owner, data: { action: result.action, to: result.to, due: result.due, doneAt: null, messageId: null }, createdAt: at },
        ]);
        out.finished += 1;
      } else out.failed += 1;
    } catch (err) {
      out.failed += 1;
      console.warn("[next-action] finish failed", r.id, err instanceof Error ? err.message : err);
    }
  }
  for (const r of records.filter((x) => stateOf(x).status === "pending").slice(0, opts.limit ?? 6)) {
    if (Date.now() > opts.deadline) break;
    try {
      const brief = await nextActionBrief(store, r.id);
      const executionId = await startExecution(agentId, { deal_brief: brief });
      const next: NextActionState = { status: "running", executionId, startedAt: new Date().toISOString() };
      await store.upsertRecords([{ kind: "next_action", id: r.id, dealKey: r.dealKey, data: next as unknown as Record<string, unknown>, createdAt: r.createdAt }]);
      out.started += 1;
    } catch (err) {
      out.failed += 1;
      const next: NextActionState = { status: "failed", error: String(err).slice(0, 300) };
      await store.upsertRecords([{ kind: "next_action", id: r.id, dealKey: r.dealKey, data: next as unknown as Record<string, unknown>, createdAt: r.createdAt }]);
    }
  }
  return out;
}

const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "have", "will", "send", "please", "them", "their", "our", "are", "was", "has", "not", "you", "your"]);
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w)));

/** Does an outgoing mail carry out this action? At least a third of the action's words appear in it. */
export function carriesOut(action: string, mailText: string): boolean {
  const want = words(action);
  if (want.size < 2) return false;
  const have = words(mailText);
  let hit = 0;
  for (const w of want) if (have.has(w)) hit += 1;
  return hit / want.size >= 0.34;
}

/**
 * Close open log rows on deals where our side sent a mail after the action was made.
 * Returns how many were marked done.
 */
export async function markTakenFromMail(store: MailStore, dealKeys: string[]): Promise<number> {
  let marked = 0;
  for (const dealKey of [...new Set(dealKeys)].slice(0, 60)) {
    const open = (await store.listRecords({ kind: "next_action_log", dealKey, limit: 10 })).filter((r) => !r.data.doneAt);
    if (!open.length) continue;
    const mails = (await store.messagesForDeal(dealKey, 40)).filter((m) => m.sent_at && OURS.test(m.from_email || ""));
    for (const log of open) {
      const hit = mails.find(
        (m) => (m.sent_at || "") > log.createdAt && carriesOut(String(log.data.action || ""), `${m.subject || ""}\n${freshText(m.body_text || "", m.subject || "")}`),
      );
      if (!hit) continue;
      await store.upsertRecords([
        { kind: "next_action_log", id: log.id, dealKey, owner: log.owner, data: { ...log.data, doneAt: new Date(hit.sent_at!).toISOString(), messageId: hit.internet_message_id || hit.provider_message_id }, createdAt: log.createdAt },
      ]);
      marked += 1;
    }
  }
  return marked;
}

/** Share of actions taken within two days, overall and per owner. */
export function takenStats(logs: MailRecord[], now = Date.now()) {
  const eligible = logs.filter((l) => now - Date.parse(l.createdAt) >= 2 * 86_400_000);
  const taken = eligible.filter((l) => {
    const done = typeof l.data.doneAt === "string" ? Date.parse(l.data.doneAt) : NaN;
    return Number.isFinite(done) && done - Date.parse(l.createdAt) <= 2 * 86_400_000;
  });
  const byOwner: Record<string, { total: number; taken: number }> = {};
  for (const l of eligible) {
    const o = l.owner || "unassigned";
    byOwner[o] ||= { total: 0, taken: 0 };
    byOwner[o]!.total += 1;
    if (taken.includes(l)) byOwner[o]!.taken += 1;
  }
  return { total: eligible.length, taken: taken.length, rate: eligible.length ? taken.length / eligible.length : null, byOwner };
}
