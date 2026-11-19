import { mapProcessedDeal, type ProcessedDealRow } from "./processedDealMapper";
import { enrichMailboxDeals } from "./enrichMailboxDeals";
import { useTradeStore } from "./store";
import { readBookSnapshot, writeBookSnapshot } from "./bookCache";
import { fetchAllProcessedDeals, hashString } from "./processedDealsClient";

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

type HydrateOptions = {
  /** Explicit refresh (button, after sync): re-apply even if nothing changed. */
  force?: boolean;
};

let inflight: Promise<MailboxHydrateResult> | null = null;
let lastSignature: string | null = null;
let lastCount = 0;
let lastSpendUsd = 0;

function isTradeRow(row: ProcessedDealRow): boolean {
  if (row.status !== "completed") return false;
  const result = row.result_json as { isTradeDeal?: boolean } | null;
  return !(result && result.isTradeDeal === false);
}

/** Map raw rows to deals and replace the mailbox slice of the store. */
function applyRows(rows: ProcessedDealRow[], liveIds: Set<string>): number {
  const mapped = enrichMailboxDeals(
    rows
      .filter(isTradeRow)
      .map((row) => mapProcessedDeal(row))
      .filter((deal): deal is NonNullable<typeof deal> => Boolean(deal)),
  );
  // Deals with mail in a connected mailbox: their emails open in the inbox.
  for (const d of mapped) {
    if (d.mailboxSourceId && liveIds.has(d.mailboxSourceId)) d.liveMail = true;
  }
  // Real mailbox book replaces synthetic portfolio seeds.
  if (mapped.length > 0) useTradeStore.getState().mergeMailboxDeals(mapped);
  return mapped.length;
}

async function fetchLiveIds(): Promise<string[]> {
  try {
    const r = await fetch("/api/mail/live-deals", { cache: "no-store" });
    if (!r.ok) return [];
    const body = (await r.json()) as { ids?: string[] };
    return body.ids || [];
  } catch {
    return [];
  }
}

/**
 * Load the mailbox book into the store.
 *
 * - One run at a time: concurrent callers share the in-flight promise.
 * - First load: an IndexedDB snapshot (if any) renders immediately; otherwise
 *   the first page renders as soon as it lands and the rest stream in.
 * - Later loads are background refreshes: status stays "ready", the page keeps
 *   its content, and the store is only touched when the data changed.
 */
export function hydrateMailboxBook(
  opts: HydrateOptions = {},
): Promise<MailboxHydrateResult> {
  if (!inflight) {
    inflight = runHydrate(opts).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runHydrate(opts: HydrateOptions): Promise<MailboxHydrateResult> {
  const store = useTradeStore.getState();
  let hasData = store.mailboxBookLoadedAt != null;

  if (!hasData) {
    const snap = await readBookSnapshot();
    if (snap && snap.rows.length) {
      lastCount = applyRows(snap.rows, new Set(snap.liveIds));
      lastSignature = snap.signature;
      if (snap.failedExtracts != null) {
        store.setMailboxFailedCount(snap.failedExtracts);
      }
      store.setMailboxBookMeta({ mailboxBookLoadedAt: snap.savedAt });
      store.setMailboxBookStatus("ready");
      hasData = true;
    }
  }

  if (hasData) {
    store.setMailboxBookMeta({ mailboxBookRefreshing: true });
  } else {
    store.setMailboxBookStatus("loading");
  }

  let partialApplied = false;
  try {
    const livePromise = fetchLiveIds();
    const result = await fetchAllProcessedDeals<ProcessedDealRow>({
      fresh: opts.force,
      onFirstPage: (rows, total) => {
        if (hasData || rows.length >= total) return;
        // Cold start: show the newest deals now; the rest stream in.
        applyRows(rows, new Set());
        partialApplied = true;
        store.setMailboxBookMeta({
          mailboxBookLoadedAt: Date.now(),
          mailboxBookProgress: { loaded: rows.length, total },
        });
        store.setMailboxBookStatus("ready");
      },
      onProgress: (loaded, total) => {
        if (partialApplied) {
          store.setMailboxBookMeta({
            mailboxBookProgress: { loaded: Math.min(loaded, total), total },
          });
        }
      },
    });
    const liveIds = await livePromise;
    const signature = `${result.signature}:${hashString(liveIds.slice().sort().join(","))}`;
    const failed = result.counts.byStatus?.failed;
    lastSpendUsd = Number(result.counts.spendUsd || 0);

    const changed = signature !== lastSignature;
    if (changed || opts.force || partialApplied) {
      lastCount = applyRows(result.rows, new Set(liveIds));
      lastSignature = signature;
      void writeBookSnapshot({
        signature,
        rows: result.rows,
        liveIds,
        failedExtracts: typeof failed === "number" ? failed : null,
      });
    }
    if (typeof failed === "number") store.setMailboxFailedCount(failed);
    store.setMailboxBookMeta({
      mailboxBookLoadedAt: Date.now(),
      mailboxBookRefreshing: false,
      mailboxBookProgress: null,
    });
    store.setMailboxBookStatus("ready");

    return {
      count: lastCount,
      spendUsd: lastSpendUsd,
      progress: (result.progress as MailboxProgress | null) || null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mailbox load failed";
    if (hasData || partialApplied) {
      // Keep what is on screen; surface the failure without blanking pages.
      store.setMailboxBookMeta({
        mailboxBookRefreshing: false,
        mailboxBookProgress: null,
        mailboxBookError: message,
      });
    } else {
      store.setMailboxBookStatus("error", message);
    }
    return { count: lastCount, spendUsd: lastSpendUsd, progress: null, error: message };
  }
}
