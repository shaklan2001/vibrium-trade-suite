import path from "path";
import type {
  EvidenceMessage,
  EvidencePayload,
  ProcessedDealRow,
} from "@/lib/trade/processedDealMapper";
import {
  commercialModelOf,
  isUsefulAttachment,
  partyRole,
  poKey,
  primaryStage,
  stageOf,
  type ClassifyContext,
} from "./classify";
import type { StoredAttachment, StoredMailMessage } from "./types";

/**
 * Deal pack for one deal_key — the live-mail equivalent of one line in
 * data/pst_extract/relevant/deals.jsonl. When the PST book already holds the
 * deal (same po:/bkg:/topic: id), its evidence messages are merged in so a new
 * reply extends the deal instead of replacing its history.
 */

const EMAIL_CHAR_LIMIT = 24_000;
const EVIDENCE_MESSAGES = 40;

type PackAttachment = {
  name: string;
  ext: string;
  sha256?: string;
  s3_key?: string;
  path?: string;
  url?: string;
  useful: boolean;
};

export type PackMessage = {
  id: string;
  internet_message_id: string | null;
  date: string | null;
  from: string;
  from_name: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  role: string;
  attachments: PackAttachment[];
  source: "live" | "book";
};

export type DealPack = {
  id: string;
  subject: string;
  subjects: string[];
  po_numbers: string[];
  primary_stage: string;
  commercial_model: "agency_commission" | "trader_principal";
  date_start: string | null;
  date_end: string | null;
  message_count: number;
  doc_count: number;
  roles: Record<string, number>;
  parties: Record<string, string[]>;
  messages: PackMessage[];
  /** Uploaded, worker-readable files (live mail only). */
  documents: (PackAttachment & { s3_key: string })[];
  agent_email_text: string;
  live_count: number;
  existing: {
    status: string | null;
    has_result: boolean;
  } | null;
};

function isoMinute(date: string | null | undefined) {
  if (!date) return "";
  const t = Date.parse(date);
  return Number.isNaN(t) ? String(date).slice(0, 16) : new Date(t).toISOString().slice(0, 16);
}

function fingerprint(m: { date: string | null; from: string; subject: string }) {
  return `${isoMinute(m.date)}|${m.from.toLowerCase()}|${m.subject.trim().toLowerCase()}`;
}

function asText(v: string | string[] | undefined) {
  return Array.isArray(v) ? v.join(", ") : v || "";
}

function liveAttachment(a: StoredAttachment): PackAttachment {
  return {
    name: a.name,
    ext: a.ext || path.extname(a.name).toLowerCase(),
    sha256: a.sha256,
    s3_key: a.s3_key,
    // path ending in {sha256}.ext → /api/ingest-files?digest=… opens it
    path: a.s3_key ? `mail/${a.sha256}${a.ext || ""}` : undefined,
    useful: isUsefulAttachment(a),
  };
}

function parseEvidence(row: ProcessedDealRow | null): EvidencePayload {
  const raw = row?.evidence_json;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EvidencePayload;
    } catch {
      return {};
    }
  }
  return raw as EvidencePayload;
}

function bookMessage(m: EvidenceMessage, i: number, ctx: ClassifyContext): PackMessage {
  const from = (m.from || "").toLowerCase();
  return {
    id: m.id || `book-${i}`,
    internet_message_id: null,
    date: m.date || null,
    from,
    from_name: m.from_name || "",
    to: asText(m.to),
    cc: asText(m.cc),
    subject: m.subject || "",
    body: m.body || "",
    role: partyRole(from, ctx),
    attachments: (m.attachments || [])
      .filter((a) => a?.name)
      .map((a) => ({
        name: a.name!,
        ext: path.extname(a.name!).toLowerCase(),
        path: a.path,
        url: a.url,
        useful: false,
      })),
    source: "book",
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
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

/** Port of build_relevant_deals.agent_text, keeping the newest mail when clipping. */
function agentText(messages: PackMessage[]) {
  const blocks = messages.map((msg, i) => {
    const header = [
      `[Message ${i + 1}/${messages.length}]`,
      `From: ${msg.from_name} <${msg.from}>`.trim(),
      `Role: ${msg.role || "other"}`,
      `Date: ${msg.date || ""}`,
      `To: ${msg.to}`,
    ];
    if (msg.cc) header.push(`Cc: ${msg.cc}`);
    header.push(`Subject: ${msg.subject}`);
    if (msg.attachments.length)
      header.push(`Attachments: ${msg.attachments.map((a) => a.name).join(", ")}`);
    return `${header.join("\n")}\n\n${msg.body.trim()}`;
  });
  const sep = "\n\n----------\n\n";
  // Live deals grow at the tail, so drop the oldest blocks first (the PST
  // runner clips from the end instead because its packs are historical).
  while (blocks.length > 1 && blocks.join(sep).length > EMAIL_CHAR_LIMIT) blocks.shift();
  const text = blocks.join(sep);
  return text.length > EMAIL_CHAR_LIMIT
    ? `${text.slice(0, EMAIL_CHAR_LIMIT)}\n\n[truncated for worker input]`
    : text;
}

export function buildDealPack(
  dealKey: string,
  live: StoredMailMessage[],
  existing: ProcessedDealRow | null,
  ctx: ClassifyContext,
): DealPack {
  const seenIds = new Set<string>();
  const seenPrints = new Set<string>();
  const messages: PackMessage[] = [];

  for (const m of live) {
    const iid = m.internet_message_id;
    // The same internet message is often copied into several connected inboxes.
    if (iid && seenIds.has(iid)) continue;
    const from = (m.from_email || "").toLowerCase();
    const msg: PackMessage = {
      id: iid || m.provider_message_id,
      internet_message_id: iid,
      date: m.sent_at ? new Date(m.sent_at).toISOString() : null,
      from,
      from_name: m.from_name || "",
      to: m.to_text || "",
      cc: m.cc_text || "",
      subject: m.subject || "",
      body: m.body_text || "",
      role: partyRole(from, ctx),
      attachments: parseJson<StoredAttachment[]>(m.attachments_json, []).map(liveAttachment),
      source: "live",
    };
    const print = fingerprint(msg);
    if (seenPrints.has(print)) continue;
    if (iid) seenIds.add(iid);
    seenPrints.add(print);
    messages.push(msg);
  }
  const liveCount = messages.length;

  const evidence = parseEvidence(existing);
  (evidence.messages || []).forEach((m, i) => {
    const msg = bookMessage(m, i, ctx);
    const print = fingerprint(msg);
    if (seenPrints.has(print)) return;
    seenPrints.add(print);
    messages.push(msg);
  });

  messages.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const roles: Record<string, number> = {};
  const parties: Record<string, Set<string>> = {
    buyer: new Set(),
    factory: new Set(),
    forwarder: new Set(),
    trader: new Set(),
    internal: new Set(),
  };
  for (const msg of messages) {
    roles[msg.role] = (roles[msg.role] || 0) + 1;
    if (parties[msg.role] && msg.from) parties[msg.role]!.add(msg.from);
  }
  const existingParties = parseJson<Record<string, string[]>>(existing?.parties_json, {});
  for (const [role, emails] of Object.entries(existingParties)) {
    if (!parties[role] || !Array.isArray(emails)) continue;
    for (const e of emails) parties[role]!.add(String(e).toLowerCase());
  }
  const partyLists = Object.fromEntries(
    Object.entries(parties)
      .filter(([, v]) => v.size)
      .map(([k, v]) => [k, [...v].sort()]),
  );

  const subjects = [...new Set(messages.map((m) => m.subject).filter(Boolean))];
  const lastSubject = messages.at(-1)?.subject || existing?.subject || "";
  const firstBodies = messages.slice(0, 5).map((m) => m.body.slice(0, 800)).join(" ");
  const lastBodies = messages.slice(-3).map((m) => m.body.slice(0, 800)).join(" ");
  const stages = new Set([stageOf(lastSubject, firstBodies), stageOf(lastSubject, lastBodies)]);
  if (existing?.primary_stage) stages.add(existing.primary_stage);

  const pos = new Set<string>(parseJson<string[]>(existing?.po_numbers, []));
  if (dealKey.startsWith("po:")) pos.add(dealKey.slice(3));
  for (const s of subjects) {
    const po = poKey(s);
    if (po) pos.add(po);
  }

  const documents: DealPack["documents"] = [];
  const seenDocs = new Set<string>();
  const allNames = new Set<string>();
  for (const msg of messages) {
    for (const a of msg.attachments) {
      allNames.add(a.sha256 || a.name);
      if (!a.useful || !a.s3_key || !a.sha256 || seenDocs.has(a.sha256)) continue;
      seenDocs.add(a.sha256);
      documents.push(a as PackAttachment & { s3_key: string });
    }
  }

  const blob = messages
    .slice(0, 8)
    .map((m) => `${m.subject} ${m.body.slice(0, 400)}`)
    .join(" ");
  const addresses = messages.flatMap((m) => [m.from, m.to, m.cc]);
  const model =
    existing?.commercial_model === "trader_principal"
      ? "trader_principal"
      : commercialModelOf(blob, partyLists, addresses);

  return {
    id: dealKey,
    subject: existing?.subject || messages[0]?.subject || lastSubject,
    subjects: subjects.slice(0, 8),
    po_numbers: [...pos].sort(),
    primary_stage: primaryStage(stages),
    commercial_model: model,
    date_start: messages[0]?.date || existing?.date_start || null,
    date_end: messages.at(-1)?.date || existing?.date_end || null,
    message_count: messages.length,
    doc_count: Math.max(allNames.size, Number(existing?.doc_count || 0)),
    roles,
    parties: partyLists,
    messages,
    documents,
    agent_email_text: agentText(messages),
    live_count: liveCount,
    existing: existing
      ? { status: existing.status ?? null, has_result: existing.result_json != null }
      : null,
  };
}

/** Port of process_deals.deal_context_notes. */
export function dealContextNotes(pack: DealPack) {
  const p = pack.parties;
  const lines = [
    `commercial_model: ${pack.commercial_model}`,
    "agency_commission = SNSPL is referee only; buyer↔exporter settle directly; SNSPL earns commission.",
    "trader_principal = Global Praise (or SNSPL trading) buys/sells as principal; grip cash & inventory.",
    `message_count: ${pack.message_count}`,
    `po_numbers: ${pack.po_numbers.join(", ") || "none"}`,
    `buyers: ${(p.buyer || []).slice(0, 4).join(", ") || "none"}`,
    `factories: ${(p.factory || []).slice(0, 4).join(", ") || "none"}`,
    `trader: ${(p.trader || []).slice(0, 4).join(", ") || "none"}`,
    `forwarders: ${(p.forwarder || []).slice(0, 4).join(", ") || "none"}`,
    "mail_chain (oldest→newest):",
  ];
  const chain = pack.messages.slice(-40);
  if (pack.messages.length > 40) lines.push(`  … ${pack.messages.length - 40} earlier messages`);
  chain.forEach((m, i) => {
    lines.push(
      `  #${pack.messages.length - chain.length + i + 1} ${m.date || ""} | ${m.role} | ${m.from.slice(0, 40)} | ${m.subject.slice(0, 80)}`,
    );
  });
  return lines.join("\n");
}

/** Port of process_deals.build_evidence (newest 40 messages, not oldest). */
export function buildEvidence(
  pack: DealPack,
  opts: { slot: string; emailText: string; documentName: string | null; documentUrl: string | null },
): EvidencePayload {
  const messages: EvidenceMessage[] = pack.messages.slice(-EVIDENCE_MESSAGES).map((m) => ({
    id: m.id,
    subject: m.subject,
    from: m.from,
    from_name: m.from_name,
    to: m.to,
    cc: m.cc,
    date: m.date || undefined,
    body: m.body.length > 10_000 ? `${m.body.slice(0, 10_000)}\n\n[truncated]` : m.body,
    attachments: m.attachments.map((a) => {
      const entry: { name: string; path?: string; url?: string } = { name: a.name };
      if (a.path) entry.path = a.path;
      if (a.url) entry.url = a.url;
      if (opts.documentUrl && opts.documentName && a.name === opts.documentName && a.s3_key)
        entry.url = opts.documentUrl;
      return entry;
    }),
  }));
  return {
    commercial_model: pack.commercial_model,
    slot: opts.slot,
    email_text: opts.emailText.slice(0, EMAIL_CHAR_LIMIT),
    document_name: opts.documentName || undefined,
    document_url: opts.documentUrl || undefined,
    messages,
    message_count: pack.message_count,
    doc_count: pack.doc_count,
  };
}
