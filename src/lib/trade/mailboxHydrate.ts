import { mapProcessedDeal, type ProcessedDealRow } from "./processedDealMapper";
import { enrichMailboxDeals } from "./enrichMailboxDeals";
import { useTradeStore } from "./store";

export type MailboxProgress = {
  running?: boolean;
  target?: number;
  completed?: number;
  failed?: number;
  cost_usd?: number;
  eta_s?: number | null;
  etd?: string | null;
  current?: { subject?: string } | null;
  updated_at?: string;
};

export type MailboxHydrateResult = {
  count: number;
  spendUsd: number;
  progress: MailboxProgress | null;
  error?: string;
};

/** Short client-facing copy for Neon / mailbox API failures. */
export function friendlyMailboxError(error: string): string {
  const lower = error.toLowerCase();
  if (
    lower.includes("exceeded the quota") ||
    lower.includes("http status 402") ||
    lower.includes("upgrade your plan")
  ) {
    return "Database quota exceeded on the old Neon project. Refresh after the new database is live.";
  }
  if (error.length > 180) return `${error.slice(0, 180)}…`;
  return error;
}

const PAGE_SIZE = 400;

export async function hydrateMailboxBook(): Promise<MailboxHydrateResult> {
  const allRows: ProcessedDealRow[] = [];
  const seen = new Set<string>();
  let spendUsd = 0;
  let progress: MailboxProgress | null = null;
  let offset = 0;
  let totalHint = Number.POSITIVE_INFINITY;

  while (offset < totalHint && offset < 20_000) {
    const res = await fetch(
      `/api/processed-deals?limit=${PAGE_SIZE}&offset=${offset}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      error?: string;
      deals?: ProcessedDealRow[];
      counts?: { spendUsd?: number; total?: number };
      progress?: MailboxProgress | null;
    };
    if (!res.ok) {
      return {
        count: 0,
        spendUsd: 0,
        progress: body.progress || null,
        error: body.error || `HTTP ${res.status}`,
      };
    }
    const batch = body.deals || [];
    let fresh = 0;
    for (const row of batch) {
      const id = row.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      allRows.push(row);
      fresh += 1;
    }
    spendUsd = Number(body.counts?.spendUsd || spendUsd);
    progress = body.progress || progress;
    if (typeof body.counts?.total === "number") {
      totalHint = body.counts.total;
    }
    // Stop when the page is short, empty, or offset is ignored by an old proxy.
    if (batch.length < PAGE_SIZE || fresh === 0) break;
    offset += PAGE_SIZE;
  }

  const mapped = enrichMailboxDeals(
    allRows
      .filter((row) => row.status === "completed")
      .filter((row) => {
        const result = row.result_json as { isTradeDeal?: boolean } | null;
        if (result && result.isTradeDeal === false) return false;
        return true;
      })
      .map((row) => mapProcessedDeal(row))
      .filter((deal): deal is NonNullable<typeof deal> => Boolean(deal)),
  );

  const store = useTradeStore.getState();
  if (mapped.length > 0) {
    // Real mailbox book replaces synthetic portfolio seeds.
    store.mergeMailboxDeals(mapped);
  }

  return {
    count: mapped.length,
    spendUsd,
    progress,
  };
}
