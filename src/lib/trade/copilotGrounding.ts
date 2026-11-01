import { invokeTradeSuiteRds, isRdsProxyEnabled } from "@/lib/rdsProxy";
import { getSql } from "@/lib/db";
import {
  mapProcessedDeal,
  type ProcessedDealRow,
} from "@/lib/trade/processedDealMapper";

const CONTEXT_BUDGET = 12_000;
const USER_MSG_MAX = 2_000;

/** Pull person/email-like tokens from a natural-language question. */
function extractSearchHints(message: string): string[] {
  const hints = new Set<string>();
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const m of message.match(emailRe) || []) {
    hints.add(m.toLowerCase());
  }
  // First names / tokens that look like teammate searches (e.g. kalpana)
  for (const tok of message.toLowerCase().split(/[^a-z0-9@._-]+/)) {
    if (tok.length < 3 || tok.length > 40) continue;
    if (
      [
        "the",
        "and",
        "for",
        "what",
        "how",
        "many",
        "show",
        "open",
        "deal",
        "deals",
        "today",
        "overdue",
        "payment",
        "pipeline",
        "stage",
        "please",
        "about",
        "with",
        "from",
        "that",
        "this",
        "have",
        "need",
        "next",
        "list",
        "all",
        "my",
      ].includes(tok)
    ) {
      continue;
    }
    if (/^\d+$/.test(tok)) continue;
    hints.add(tok);
  }
  return [...hints].slice(0, 4);
}

function compactDeal(row: ProcessedDealRow) {
  const deal = mapProcessedDeal(row, { fullEvidence: false });
  if (!deal) {
    return {
      code: row.id,
      title: (row.subject || row.id).slice(0, 120),
      stage: row.primary_stage || "other",
      model: row.commercial_model || undefined,
      parties: [] as string[],
      emails: [] as string[],
      payment: undefined as string | undefined,
      paymentDue: undefined as string | undefined,
      docsMissing: undefined as string[] | undefined,
      production: (row.summary || "").slice(0, 120) || undefined,
      po: (row.po_numbers || []).map(String).slice(0, 4),
    };
  }
  const emails = [
    ...new Set(
      [
        ...(deal.parties || []).map((p) => p.email).filter(Boolean),
        ...(deal.sources || [])
          .flatMap((s) => [s.from, s.to, s.cc])
          .filter(Boolean),
        deal.searchText || "",
      ].filter(Boolean) as string[],
    ),
  ].slice(0, 8);
  return {
    code: deal.code,
    title: deal.title.slice(0, 120),
    stage: deal.stage,
    model: deal.commercialModel,
    parties: (deal.parties || [])
      .map((p) => `${p.role}:${p.company || p.name}`)
      .slice(0, 4),
    emails,
    payment: deal.payment?.status,
    paymentDue: deal.payment?.dueDate,
    docsMissing: deal.docsPack?.missing,
    production: deal.production?.summary?.slice(0, 120),
    po: (deal.mailboxPoNumbers || []).slice(0, 4),
  };
}

async function fetchDealsViaProxy(opts: {
  q?: string;
  limit: number;
}): Promise<{ deals: ProcessedDealRow[]; counts?: Record<string, unknown> }> {
  const res = await invokeTradeSuiteRds<ProcessedDealRow[]>({
    action: "list_deals",
    limit: opts.limit,
    offset: 0,
    q: opts.q || undefined,
  });
  if (!res.success) {
    throw new Error(res.error || "Failed to load mailbox book");
  }
  return { deals: res.data || [], counts: res.counts as Record<string, unknown> };
}

async function fetchDealsViaNeon(opts: {
  q?: string;
  limit: number;
}): Promise<{ deals: ProcessedDealRow[]; counts?: Record<string, unknown> }> {
  if (!process.env.DATABASE_URL) {
    return { deals: [] };
  }
  const sql = getSql();
  const like = opts.q
    ? `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`
    : null;
  const rows = like
    ? await sql`
        SELECT
          id, po_numbers, subject, primary_stage, slot, agent_id,
          status, summary, confidence, date_start, date_end,
          message_count, doc_count, parties_json, error, processed_at,
          cost_usd, result_json, commercial_model, evidence_json,
          document_name, document_url
        FROM processed_deals
        WHERE
          subject ILIKE ${like} ESCAPE '\\'
          OR parties_json::text ILIKE ${like} ESCAPE '\\'
          OR evidence_json::text ILIKE ${like} ESCAPE '\\'
          OR coalesce(summary, '') ILIKE ${like} ESCAPE '\\'
        ORDER BY date_end DESC NULLS LAST
        LIMIT ${opts.limit}
      `
    : await sql`
        SELECT
          id, po_numbers, subject, primary_stage, slot, agent_id,
          status, summary, confidence, date_start, date_end,
          message_count, doc_count, parties_json, error, processed_at,
          cost_usd, result_json, commercial_model, evidence_json,
          document_name, document_url
        FROM processed_deals
        ORDER BY date_end DESC NULLS LAST
        LIMIT ${opts.limit}
      `;
  const [{ total }] = (await sql`SELECT count(*)::int AS total FROM processed_deals`) as {
    total: number;
  }[];
  return {
    deals: (Array.isArray(rows) ? rows : []) as ProcessedDealRow[],
    counts: { total },
  };
}

async function loadBookSlice(message: string): Promise<{
  counts?: Record<string, unknown>;
  deals: ReturnType<typeof compactDeal>[];
  matchedOn?: string;
}> {
  const hints = extractSearchHints(message);
  const fetch = isRdsProxyEnabled() ? fetchDealsViaProxy : fetchDealsViaNeon;

  // Prefer person/email-scoped slice when the question names someone.
  for (const hint of hints) {
    const { deals, counts } = await fetch({ q: hint, limit: 80 });
    if (deals.length > 0) {
      return {
        counts,
        matchedOn: hint,
        deals: deals.map(compactDeal),
      };
    }
  }

  const { deals, counts } = await fetch({ limit: 60 });
  return { counts, deals: deals.map(compactDeal) };
}

/**
 * Build the Vibrium chat message: user question + compact live book grounding.
 * Keeps total under the platform message limit.
 */
export async function buildGroundedChatMessage(
  userMessage: string,
  focusDealId?: string,
): Promise<string> {
  const question = userMessage.trim().slice(0, USER_MSG_MAX);
  let book: Awaited<ReturnType<typeof loadBookSlice>>;
  try {
    book = await loadBookSlice(question);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "book unavailable";
    return `${question}

[Live mailbox book unavailable: ${reason}. Answer generally and ask the user to refresh mailbox data.]`;
  }

  const payload: Record<string, unknown> = {
    bookTotal: book.counts?.total ?? book.deals.length,
    byStage: book.counts?.byStage,
    matchedOn: book.matchedOn,
    dealsInContext: book.deals.length,
    deals: book.deals,
  };
  if (focusDealId) {
    payload.focusDealId = focusDealId;
  }

  let json = JSON.stringify(payload);
  if (json.length > CONTEXT_BUDGET) {
    // Shrink deal list until it fits.
    const slim = {
      bookTotal: payload.bookTotal,
      byStage: payload.byStage,
      matchedOn: payload.matchedOn,
      dealsInContext: 25,
      deals: book.deals.slice(0, 25),
    };
    json = JSON.stringify(slim);
    if (json.length > CONTEXT_BUDGET) {
      json = JSON.stringify({
        bookTotal: payload.bookTotal,
        matchedOn: payload.matchedOn,
        dealsInContext: 12,
        deals: book.deals.slice(0, 12),
        note: "Context truncated — ask to narrow by person, stage, or PO.",
      }).slice(0, CONTEXT_BUDGET);
    }
  }

  return `${question}

[Live SNSPL mailbox book — answer only from this data. Be concise and business-facing. Never invent deals. Never mention bot ids, agent ids, execution ids, or other internal system identifiers.]
${json}`;
}
