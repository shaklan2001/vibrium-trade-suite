/**
 * Browser-side loader for `/api/processed-deals`.
 *
 * - Page 0 first (it carries `counts.total`), then the remaining pages in
 *   parallel — ~4s for the full book instead of ~15s of back-to-back pages.
 * - Identical concurrent requests share one in-flight promise, and a result
 *   younger than `REUSE_MS` is handed back as-is, so the header hydrator and the
 *   Mailbox book page never download the same book twice.
 * - Each result carries a content signature so callers can skip re-mapping and
 *   store writes when nothing changed server-side.
 */

import { isLiveDealRow } from "@/lib/mail/viewWindow";

export const PROCESSED_DEALS_PAGE_SIZE = 400;
const MAX_PARALLEL = 5;
const MAX_ROWS = 20_000;
const REUSE_MS = 15_000;

export type ProcessedDealsCounts = {
  total: number;
  byStage: Record<string, number>;
  byStatus: Record<string, number>;
  spendUsd?: number;
};

type PageBody<Row> = {
  error?: string;
  deals?: Row[];
  counts?: Partial<ProcessedDealsCounts>;
  progress?: unknown;
};

export type ProcessedDealsResult<Row> = {
  rows: Row[];
  counts: ProcessedDealsCounts;
  progress: unknown;
  /** Hash of every row's content — equal signatures mean identical rows. */
  signature: string;
  fetchedAt: number;
};

export type FetchProcessedDealsOptions<Row> = {
  stage?: string;
  /** Source filter: "connected" or one connection id. */
  mailbox?: string;
  /** Called once with the first page, before the rest arrive. */
  onFirstPage?: (rows: Row[], total: number) => void;
  /** Called as pages land: rows received so far vs expected total. */
  onProgress?: (loaded: number, total: number) => void;
  /** Ignore the short-lived reuse window (explicit "Refresh"). */
  fresh?: boolean;
};

const inflight = new Map<string, Promise<ProcessedDealsResult<unknown>>>();
const recent = new Map<string, ProcessedDealsResult<unknown>>();

/** FNV-1a 32-bit over a string, hex. Fast enough for a few MB. */
export function hashString(text: string, seed = 0x811c9dc5): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function keyFor(stage?: string, mailbox?: string) {
  return `${stage || "all"}|${mailbox || "all"}`;
}

async function fetchPage<Row>(
  stage: string | undefined,
  mailbox: string | undefined,
  offset: number,
): Promise<PageBody<Row>> {
  const params = new URLSearchParams({
    limit: String(PROCESSED_DEALS_PAGE_SIZE),
    offset: String(offset),
  });
  if (stage && stage !== "all") params.set("stage", stage);
  if (mailbox && mailbox !== "all") params.set("mailbox", mailbox);
  const res = await fetch(`/api/processed-deals?${params}`, {
    cache: "no-store",
  });
  let body: PageBody<Row>;
  try {
    body = (await res.json()) as PageBody<Row>;
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/** Run `tasks` with at most `limit` in flight; results keep input order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return out;
}

async function load<Row extends { id?: string | null }>(
  opts: FetchProcessedDealsOptions<Row>,
): Promise<ProcessedDealsResult<Row>> {
  const { stage, mailbox } = opts;
  const rows: Row[] = [];
  const seen = new Set<string>();
  const pageHashes: string[] = [];
  let counts: ProcessedDealsCounts = { total: 0, byStage: {}, byStatus: {} };
  let progress: unknown = null;

  const absorb = (body: PageBody<Row>) => {
    const batch = body.deals || [];
    let fresh = 0;
    for (const row of batch) {
      const id = row.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh += 1;
      // Dead deals (no mail for 6 months) are not shown; paging still counts them.
      if (isLiveDealRow(row as never)) rows.push(row);
    }
    pageHashes.push(hashString(JSON.stringify(batch)));
    if (body.counts) counts = { ...counts, ...body.counts } as ProcessedDealsCounts;
    progress = body.progress ?? progress;
    return { size: batch.length, fresh };
  };

  const first = await fetchPage<Row>(stage, mailbox, 0);
  const firstStats = absorb(first);
  const total =
    typeof first.counts?.total === "number" ? first.counts.total : rows.length;
  opts.onFirstPage?.(rows.slice(), total);
  opts.onProgress?.(rows.length, total);

  let more = firstStats.size >= PROCESSED_DEALS_PAGE_SIZE && firstStats.fresh > 0;
  let offset = PROCESSED_DEALS_PAGE_SIZE;

  if (more) {
    // Everything the first page's total says exists, fetched in parallel.
    const offsets: number[] = [];
    for (let o = offset; o < Math.min(total, MAX_ROWS); o += PROCESSED_DEALS_PAGE_SIZE) {
      offsets.push(o);
    }
    if (offsets.length) {
      const bodies = await pool(
        offsets.map((o) => () => fetchPage<Row>(stage, mailbox, o)),
        MAX_PARALLEL,
      );
      let last = { size: 0, fresh: 0 };
      for (const body of bodies) {
        last = absorb(body);
        opts.onProgress?.(rows.length, Math.max(total, rows.length));
      }
      offset = offsets[offsets.length - 1] + PROCESSED_DEALS_PAGE_SIZE;
      more = last.size >= PROCESSED_DEALS_PAGE_SIZE && last.fresh > 0;
    }
    // Rows added after the first page was counted: keep paging until short.
    while (more && offset < MAX_ROWS) {
      const body = await fetchPage<Row>(stage, mailbox, offset);
      const stats = absorb(body);
      opts.onProgress?.(rows.length, Math.max(total, rows.length));
      more = stats.size >= PROCESSED_DEALS_PAGE_SIZE && stats.fresh > 0;
      offset += PROCESSED_DEALS_PAGE_SIZE;
    }
  }

  // Counts follow what is shown.
  const shown = rows as unknown as { primary_stage?: string | null; status?: string | null }[];
  const byStage: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of shown) {
    if (r.primary_stage) byStage[r.primary_stage] = (byStage[r.primary_stage] || 0) + 1;
    if (r.status) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  counts = { ...counts, total: rows.length, byStage, byStatus };

  return {
    rows,
    counts,
    progress,
    signature: hashString(pageHashes.join(":")),
    fetchedAt: Date.now(),
  };
}

/**
 * Fetch every processed deal for a stage/source filter. Shares in-flight work
 * and very recent results between callers with the same filter.
 */
export function fetchAllProcessedDeals<Row extends { id?: string | null }>(
  opts: FetchProcessedDealsOptions<Row> = {},
): Promise<ProcessedDealsResult<Row>> {
  const key = keyFor(opts.stage, opts.mailbox);
  const running = inflight.get(key);
  if (running) return running as Promise<ProcessedDealsResult<Row>>;
  const cached = recent.get(key);
  if (!opts.fresh && cached && Date.now() - cached.fetchedAt < REUSE_MS) {
    return Promise.resolve(cached as ProcessedDealsResult<Row>);
  }
  const promise = load(opts)
    .then((result) => {
      recent.set(key, result as ProcessedDealsResult<unknown>);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise as Promise<ProcessedDealsResult<unknown>>);
  return promise;
}
