import { mapProcessedDeal, type ProcessedDealRow } from "./processedDealMapper";
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

export async function hydrateMailboxBook(): Promise<MailboxHydrateResult> {
  const res = await fetch("/api/processed-deals", { cache: "no-store" });
  const body = (await res.json()) as {
    error?: string;
    deals?: ProcessedDealRow[];
    counts?: { spendUsd?: number };
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
  const mapped = (body.deals || [])
    .filter((row) => row.status === "completed")
    .filter((row) => {
      const result = row.result_json as { isTradeDeal?: boolean } | null;
      if (result && result.isTradeDeal === false) return false;
      return true;
    })
    .map((row) => mapProcessedDeal(row))
    .filter((deal): deal is NonNullable<typeof deal> => Boolean(deal));

  const store = useTradeStore.getState();
  if (mapped.length > 0) {
    // Real mailbox book replaces synthetic portfolio seeds.
    store.mergeMailboxDeals(mapped);
  }

  return {
    count: mapped.length,
    spendUsd: Number(body.counts?.spendUsd || 0),
    progress: body.progress || null,
  };
}
