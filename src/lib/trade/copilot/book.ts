/**
 * Server-side copy of the mailbox book for the Copilot.
 *
 * Loads every processed deal the same way the dashboard does (paginated
 * list_deals → mapProcessedDeal → enrichMailboxDeals), so the Copilot sees the
 * same numbers as Command Center. Cached in memory for a few minutes; the
 * first question after a cold start pays the load.
 */
import { getSql } from "@/lib/db";
import { invokeTradeSuiteRds, isRdsProxyEnabled } from "@/lib/rdsProxy";
import { enrichMailboxDeals } from "@/lib/trade/enrichMailboxDeals";
import {
  buildDealSearchText,
  mapProcessedDeal,
  type ProcessedDealRow,
} from "@/lib/trade/processedDealMapper";
import type { Deal } from "@/types/trade";

const PAGE_SIZE = 400;
const MAX_ROWS = 20_000;
const TTL_MS = 3 * 60 * 1000;

export type CopilotBook = {
  deals: Deal[];
  byId: Map<string, Deal>;
  /** Lowercased searchable text per deal id. */
  index: Map<string, string>;
  loadedAt: number;
};

export type RawParty = { role: string; value: string };

/**
 * Parties straight from processed_deals.parties_json. The deal mapper keeps
 * buyers / factories / traders only; this also keeps forwarders and the
 * internal SNSPL teammates on the thread.
 */
const rawParties = new WeakMap<Deal, RawParty[]>();
export function rawPartiesOf(deal: Deal): RawParty[] {
  return rawParties.get(deal) || [];
}

const ROLE_ALIASES: Record<string, string> = {
  buyers: "buyer",
  buyer: "buyer",
  factories: "factory",
  factory: "factory",
  traders: "trader",
  trader: "trader",
  forwarders: "forwarder",
  forwarder: "forwarder",
  internal: "SNSPL team",
  agency: "agency",
};

function partiesFromRow(row: ProcessedDealRow): RawParty[] {
  const pj = row.parties_json as Record<string, unknown> | null | undefined;
  if (!pj || typeof pj !== "object") return [];
  const out: RawParty[] = [];
  for (const [key, val] of Object.entries(pj)) {
    const role = ROLE_ALIASES[key] || key;
    const items = Array.isArray(val) ? val : typeof val === "string" ? [val] : [];
    for (const v of items) {
      if (typeof v === "string" && v.trim()) out.push({ role, value: v.trim().slice(0, 120) });
    }
  }
  return out.slice(0, 16);
}

let cached: CopilotBook | null = null;
let inflight: Promise<CopilotBook> | null = null;

async function fetchPage(offset: number): Promise<ProcessedDealRow[]> {
  if (isRdsProxyEnabled()) {
    const res = await invokeTradeSuiteRds<ProcessedDealRow[]>({
      action: "list_deals",
      limit: PAGE_SIZE,
      offset,
    });
    if (!res.success) throw new Error(res.error || "Failed to load mailbox book");
    return res.data || [];
  }
  if (!process.env.DATABASE_URL) return [];
  const sql = getSql();
  const rows = (await sql`
    SELECT
      id, po_numbers, subject, primary_stage, slot, agent_id,
      status, summary, confidence, date_start, date_end,
      message_count, doc_count, parties_json, error, processed_at,
      cost_usd, result_json, commercial_model, evidence_json,
      document_name, document_url
    FROM processed_deals
    ORDER BY date_end DESC NULLS LAST
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `) as ProcessedDealRow[];
  return rows.map((row) => ({
    ...row,
    search_text: buildDealSearchText(row, row.evidence_json || undefined),
    evidence_json: undefined,
  }));
}

/** Everything a person might type to find this deal, lowercased. */
export function dealSearchIndex(deal: Deal): string {
  const parts: (string | undefined)[] = [
    deal.code,
    deal.title,
    deal.mailboxSourceId,
    ...(deal.mailboxPoNumbers || []),
    deal.searchText,
    deal.booking?.bookingNumber,
    deal.booking?.carrier,
    deal.booking?.vessel,
    deal.booking?.pol,
    deal.booking?.pod,
  ];
  for (const p of deal.parties || []) {
    parts.push(p.name, p.company, p.email);
  }
  for (const doc of [deal.pi, deal.po, ...(deal.commercialDocs || [])]) {
    if (!doc) continue;
    parts.push(doc.docNumber, doc.buyer, doc.factory, doc.shipper, doc.consignee);
  }
  return parts
    .filter(Boolean)
    .join(" • ")
    .toLowerCase();
}

async function loadBook(): Promise<CopilotBook> {
  const rows: ProcessedDealRow[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const batch = await fetchPage(offset);
    let fresh = 0;
    for (const row of batch) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      fresh += 1;
    }
    if (batch.length < PAGE_SIZE || fresh === 0) break;
  }

  const deals = enrichMailboxDeals(
    rows
      .filter((row) => row.status === "completed")
      .filter((row) => {
        const result = row.result_json as { isTradeDeal?: boolean } | null;
        return !(result && result.isTradeDeal === false);
      })
      .map((row) => mapProcessedDeal(row))
      .filter((d): d is Deal => Boolean(d)),
  );

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const byId = new Map<string, Deal>();
  const index = new Map<string, string>();
  for (const d of deals) {
    byId.set(d.id, d);
    if (d.mailboxSourceId) byId.set(d.mailboxSourceId, d);
    const row = d.mailboxSourceId ? rowById.get(d.mailboxSourceId) : undefined;
    const extra = row ? partiesFromRow(row) : [];
    if (extra.length) rawParties.set(d, extra);
    index.set(
      d.id,
      `${dealSearchIndex(d)} \u2022 ${extra.map((p) => p.value.toLowerCase()).join(" ")}`,
    );
  }
  return { deals, byId, index, loadedAt: Date.now() };
}

/** Cached book; concurrent callers share one load. */
export async function getCopilotBook(opts: { force?: boolean } = {}): Promise<CopilotBook> {
  if (!opts.force && cached && Date.now() - cached.loadedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = loadBook()
    .then((book) => {
      cached = book;
      return book;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Fire-and-forget warm-up (e.g. when a chat session starts). */
export function warmCopilotBook(): void {
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return;
  void getCopilotBook().catch(() => undefined);
}
