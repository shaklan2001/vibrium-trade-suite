import type {
  EvidenceMessage,
  EvidencePayload,
  ProcessedDealRow,
} from "@/lib/trade/processedDealMapper";
import { partyRole, type ClassifyContext } from "./classify";
import type { InboxItem, InboxMessage, InboxOutcome, InboxSource } from "./inboxTypes";
import { AGENT_NAMES, factsFor, templateDraft } from "./replyDraft";
import { getMailStore } from "./store";

/**
 * The agent inbox: each deal thread becomes one inbox row showing the newest
 * mail from the other side, what the stage worker read in it, and a drafted
 * reply. `book` = deals already in the book (PST mailboxes — demo data);
 * `live` = deals built from connected inboxes.
 */

const THREAD_CAP = 12;
const BODY_CAP = 4000;
const CACHE_MS = 5 * 60 * 1000;

const NOISE_SUBJECT =
  /^(automatic reply|auto(-|\s)?reply|out of office|undeliverable|delivery status notification|read:|accepted:|declined:|invitation:)/i;
const NOISE_SENDER = /no-?reply|noreply|mailer-daemon|postmaster|notification/i;
const QUOTE_START =
  /^(On .{5,200}wrote:|From: .+|-----Original Message-----|_{10,}|>.*)$/m;

function parse<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function freshText(body: string) {
  const text = (body || "").replace(/\r/g, "");
  const m = QUOTE_START.exec(text);
  const fresh = (m ? text.slice(0, m.index) : text).replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  const out = fresh || text.trim();
  return out.length > BODY_CAP ? `${out.slice(0, BODY_CAP)}\n…` : out;
}

function asText(v: string | string[] | undefined) {
  return Array.isArray(v) ? v.join(", ") : v || "";
}

function toMessage(m: EvidenceMessage, i: number, ctx: ClassifyContext): InboxMessage {
  const from = (m.from || "").toLowerCase().trim();
  return {
    id: m.id || `m${i}`,
    from,
    fromName: (m.from_name || "").replace(/["']/g, "").trim(),
    to: asText(m.to),
    cc: asText(m.cc),
    date: m.date || null,
    subject: m.subject || "",
    body: freshText(m.body || ""),
    attachments: (m.attachments || []).map((a) => a.name || "").filter((n) => n && !/^image\d+\./i.test(n)),
    internal: partyRole(from, ctx) === "internal",
  };
}

function outcomeFor(
  slot: string | null,
  result: Record<string, unknown>,
  confidence: number | null,
  latest: InboxMessage,
  repliedAfter: boolean,
): { outcome: InboxOutcome; note: string | null } {
  if (NOISE_SUBJECT.test(latest.subject) || NOISE_SENDER.test(latest.from)) {
    return { outcome: "fyi", note: "Automatic or calendar mail — no reply needed." };
  }
  if (repliedAfter) return { outcome: "replied", note: "Our team already replied after this mail." };
  if (confidence != null && confidence < 0.6) {
    return {
      outcome: "needs_you",
      note: `The agent is only ${Math.round(confidence * 100)}% sure about this thread — check the draft against the mail.`,
    };
  }
  if (slot === "inspection_photo_summarizer") {
    return { outcome: "needs_you", note: "Quality findings — decide what the factory must fix before replying." };
  }
  if (slot === "payment_clock") {
    return { outcome: "needs_you", note: "Money involved — confirm the payment status before replying." };
  }
  if (slot === "final_docs_pack_check" && result.complete === true) {
    return { outcome: "waiting", note: "Docs pack is complete — nothing to ask for right now." };
  }
  return { outcome: "draft_ready", note: null };
}

function titleCase(word: string) {
  return word ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : "";
}

/** Who signs the reply: the SNSPL person the mail was addressed to, else our last sender. */
function signerFor(latest: InboxMessage, thread: InboxMessage[], ctx: ClassifyContext) {
  const addressed = (latest.to.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).find(
    (e) => partyRole(e, ctx) === "internal",
  );
  if (addressed) return titleCase(addressed.split("@")[0]!.split(/[._-]/)[0]!);
  const ours = [...thread].reverse().find((m) => m.internal);
  if (ours?.fromName) return ours.fromName.split(/\s+/)[0]!;
  if (ours?.from) return titleCase(ours.from.split("@")[0]!.split(/[._-]/)[0]!);
  return "Team";
}

export function buildInboxItem(row: ProcessedDealRow, ctx: ClassifyContext): InboxItem | null {
  const evidence = parse<EvidencePayload>(row.evidence_json, {});
  const all = (evidence.messages || [])
    .map((m, i) => toMessage(m, i, ctx))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const lastExternal = all.map((m) => !m.internal && Boolean(m.from)).lastIndexOf(true);
  if (lastExternal < 0) return null;

  const latest = all[lastExternal]!;
  const thread = all.slice(Math.max(0, lastExternal - THREAD_CAP + 1), lastExternal + 1);
  const repliedAfter = all.slice(lastExternal + 1).some((m) => m.internal);
  const result = parse<Record<string, unknown>>(row.result_json, {});
  const confidence = typeof row.confidence === "number" ? row.confidence : null;
  const slot = row.slot || null;
  const { outcome, note } = outcomeFor(slot, result, confidence, latest, repliedAfter);
  const subject = latest.subject || row.subject || "(no subject)";
  const item: InboxItem = {
    id: row.id,
    subject,
    latest,
    thread,
    outcome,
    note,
    stage: row.primary_stage || null,
    slot,
    agentName: (slot && AGENT_NAMES[slot]) || "Stage worker",
    agentId: row.agent_id || null,
    summary: row.summary || (typeof result.summary === "string" ? result.summary : null),
    confidence,
    facts: factsFor(slot, result),
    poNumbers: parse<string[]>(row.po_numbers, []).map(String),
    signer: signerFor(latest, all, ctx),
    draft: null,
  };
  if (outcome === "draft_ready" || outcome === "needs_you") {
    item.draft = {
      to: latest.from,
      toName: latest.fromName,
      subject: `Re: ${subject.replace(/^(re|fw|fwd)\s*:\s*/i, "")}`,
      body: templateDraft({ slot, result, latest, subject, signer: item.signer }),
      by: "template",
    };
  }
  return item;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const cache = new Map<string, { at: number; items: InboxItem[] }>();

export async function loadInbox(source: InboxSource, limit = 30): Promise<InboxItem[]> {
  const key = `${source}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;

  const store = getMailStore();
  const conns = await store.listConnections().catch(() => []);
  const ctx: ClassifyContext = { ownEmails: conns.map((c) => c.email) };

  let ids: string[];
  if (source === "live") {
    const msgs = await store.recentMessages({ limit: 200 });
    ids = [...new Set(msgs.filter((m) => m.job_status === "done" && m.deal_key).map((m) => m.deal_key!))];
  } else {
    const rows = await store.recentDeals(Math.min(limit * 3, 300));
    ids = rows
      .filter((r) => r.status === "completed" && (r.message_count || 0) > 0)
      .map((r) => r.id);
  }

  // A few spare ids: some threads have no mail from the other side and drop out.
  const rows = await mapLimit(ids.slice(0, limit + 8), 10, (id) => store.getProcessedDeal(id).catch(() => null));
  const items = rows
    .map((row) => (row ? buildInboxItem(row, ctx) : null))
    .filter((i): i is InboxItem => Boolean(i))
    .sort((a, b) => (b.latest.date || "").localeCompare(a.latest.date || ""))
    .slice(0, limit);

  cache.set(key, { at: Date.now(), items });
  return items;
}

/** One item, fresh (used by the draft endpoint). */
export async function loadInboxItem(id: string): Promise<InboxItem | null> {
  const store = getMailStore();
  const row = await store.getProcessedDeal(id);
  if (!row) return null;
  const conns = await store.listConnections().catch(() => []);
  return buildInboxItem(row, { ownEmails: conns.map((c) => c.email) });
}

