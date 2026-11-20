"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Card, Stat } from "@/components/ui/primitives";
import { LoadingBlock, ListSkeleton } from "@/components/ui/loading-block";
import { PaginationBar } from "@/components/ui/pagination";
import { SyncNowButton } from "@/components/mail/sync-now-button";
import { Select } from "@/components/ui/select";
import { fetchAllProcessedDeals } from "@/lib/trade/processedDealsClient";

type ProcessedDeal = {
  id: string;
  po_numbers: string[] | null;
  subject: string | null;
  primary_stage: string | null;
  slot: string | null;
  agent_id: string | null;
  status: string | null;
  summary: string | null;
  confidence: number | null;
  date_start: string | null;
  date_end: string | null;
  message_count: number | null;
  doc_count: number | null;
  parties_json: {
    buyers?: string[];
    buyer?: string[];
    factories?: string[];
    factory?: string[];
  } | null;
  error: string | null;
  processed_at: string | null;
};

type Counts = {
  total: number;
  byStage: Record<string, number>;
  byStatus: Record<string, number>;
};

type Progress = {
  running?: boolean;
  target?: number;
  completed?: number;
  failed?: number;
  elapsed_s?: number;
  eta_s?: number | null;
  etd?: string | null;
  rate_per_min?: number;
  current?: {
    n?: number;
    subject?: string;
    stage?: string;
    slot?: string;
    status?: string;
  } | null;
  last?: {
    subject?: string;
    status?: string;
    seconds?: number;
  } | null;
  updated_at?: string;
};

const STAGE_FILTERS = [
  "all",
  "booking",
  "pi_po",
  "payment",
  "inspection",
  "artwork",
  "quoting",
  "samples",
  "requirement",
  "other",
] as const;

const PAGE_SIZE = 30;

function stageLabel(stage: string | null | undefined) {
  if (!stage) return "—";
  return stage.replaceAll("_", " ");
}

function statusTone(status: string | null) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "skipped") return "warning" as const;
  return "neutral" as const;
}

function partyLine(parties: ProcessedDeal["parties_json"]) {
  const buyers = (parties?.buyers || parties?.buyer)?.slice(0, 2).join(", ");
  const factories = (parties?.factories || parties?.factory)
    ?.slice(0, 2)
    .join(", ");
  if (buyers && factories) return `${buyers} · ${factories}`;
  return buyers || factories || "—";
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatEtd(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Shared loader: parallel pages, deduped with the header's mailbox refresh. */
async function fetchAllDeals(stage: string, source: string) {
  const r = await fetchAllProcessedDeals<ProcessedDeal>({
    stage,
    mailbox: source,
  });
  const counts: Counts = {
    total: r.counts.total ?? r.rows.length,
    byStage: r.counts.byStage || {},
    byStatus: r.counts.byStatus || {},
  };
  return {
    deals: r.rows,
    counts,
    progress: (r.progress as Progress | null) || null,
  };
}

/** Background refresh cadence for the visible Mailbox book. */
const REFRESH_MS = 3 * 60_000;

type SourceMailbox = { id: string; email: string; display_name: string | null };

export default function MailboxPage() {
  const [stage, setStage] = useState<(typeof STAGE_FILTERS)[number]>("all");
  /** "all" = PST uploads + email, "connected" = every connected mailbox, or one connection id. */
  const [source, setSource] = useState("all");
  const [mailboxes, setMailboxes] = useState<SourceMailbox[]>([]);
  const [deals, setDeals] = useState<ProcessedDeal[]>([]);
  const [counts, setCounts] = useState<Counts>({
    total: 0,
    byStage: {},
    byStatus: {},
  });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Filter key whose rows are on screen; null until the first load lands. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [stage, source]);

  useEffect(() => {
    fetch("/api/mail/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { connections?: SourceMailbox[] }) => setMailboxes(b.connections || []))
      .catch(() => undefined);
  }, []);

  const filterKey = `${stage}|${source}`;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let schedulePending = false;
    async function load() {
      try {
        const next = await fetchAllDeals(stage, source);
        if (cancelled) return;
        setDeals(next.deals);
        setCounts(next.counts);
        setProgress(next.progress);
        setError(null);
        setLoadedKey(`${stage}|${source}`);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoadedKey((k) => k ?? `${stage}|${source}`);
      }
      if (!cancelled) {
        // Next refresh only after this one finished; skipped while hidden.
        timer = window.setTimeout(() => {
          if (document.visibilityState === "visible") void load();
          else schedulePending = true;
        }, REFRESH_MS);
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && schedulePending) {
        schedulePending = false;
        void load();
      }
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stage, source, refreshKey]);

  const live = Boolean(progress?.running);
  // Clock only matters for the "ingest may have stalled" check.
  useEffect(() => {
    if (!live) return;
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(clock);
  }, [live]);

  const loading = loadedKey === null;
  const switching = !loading && loadedKey !== filterKey;

  const completed = counts.byStatus.completed ?? 0;
  const failed = counts.byStatus.failed ?? 0;
  const target = progress?.target || 0;
  const doneN = (progress?.completed || 0) + (progress?.failed || 0);
  const pct = target ? Math.min(100, Math.round((doneN / target) * 100)) : 0;
  const stale =
    live &&
    progress?.updated_at &&
    now - new Date(progress.updated_at).getTime() > 90_000;

  const pageCount = Math.max(1, Math.ceil(deals.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () =>
      deals
        .slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
        .map((deal) => ({
          deal,
          pos: Array.isArray(deal.po_numbers) ? deal.po_numbers : [],
        })),
    [deals, safePage],
  );

  return (
    <div>
      <PageHeader
        title="Mailbox book"
        description="Deals from PST uploads and every connected team mailbox. Progress and extracted deals come from the live database."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              id="mailbox-book-source"
              variant="chip"
              label="Source"
              aria-label="Mailbox source"
              value={source}
              onChange={setSource}
              menuWidth={320}
              className="h-10"
              options={[
                { value: "all", label: "All sources (PST + email)" },
                {
                  value: "connected",
                  label: `Connected mailboxes (${mailboxes.length})`,
                },
                ...mailboxes.map((m) => ({
                  value: m.id,
                  label: m.display_name || m.email.split("@")[0],
                  description: m.email,
                })),
              ]}
            />
            <SyncNowButton onSynced={() => setRefreshKey((k) => k + 1)} />
            <Link
              href="/mailbox/connections"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50"
            >
              <Plug className="h-4 w-4" />
              Email connections
            </Link>
          </div>
        }
      />

      {progress ? (
        <Card className="mb-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                {live
                  ? stale
                    ? "Ingest may have stalled"
                    : "Ingest running"
                  : "Last ingest"}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {progress.current?.subject
                  ? `Now: ${progress.current.subject}`
                  : progress.last?.subject
                    ? `Last: ${progress.last.subject}`
                    : "Waiting for the next deal"}
              </p>
            </div>
            <Badge tone={live ? (stale ? "warning" : "info") : "neutral"}>
              {live ? `${doneN}/${target || "?"} · ${pct}%` : "idle"}
            </Badge>
          </div>
          <div className="h-1.5 bg-zinc-100">
            <div
              className="h-full bg-teal-700 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {formatEtd(progress.etd)}
              </div>
              <div className="text-xs text-zinc-500">
                ETD · ETA {formatDuration(progress.eta_s)}
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {progress.rate_per_min?.toFixed(1) || "0"}/min
              </div>
              <div className="text-xs text-zinc-500">
                Elapsed {formatDuration(progress.elapsed_s)}
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {doneN}
              </div>
              <div className="text-xs text-zinc-500">
                Completed + failed this run
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <>
          <LoadingBlock label="Loading mailbox book…" className="mb-4" />
          <ListSkeleton rows={6} />
        </>
      ) : (
        <div
          className={
            switching
              ? "pointer-events-none opacity-60 transition-opacity"
              : "transition-opacity"
          }
          aria-busy={switching}
        >
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Processed deals" value={counts.total} />
            <Stat label="Completed" value={completed} />
            <Stat label="Failed" value={failed} />
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {STAGE_FILTERS.map((id) => {
              const active = stage === id;
              const count =
                id === "all" ? counts.total : (counts.byStage[id] ?? 0);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStage(id)}
                  className={
                    active
                      ? "rounded-full bg-teal-700 px-3 py-1 text-xs font-medium text-white transition"
                      : "rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 transition hover:bg-zinc-50"
                  }
                >
                  {stageLabel(id)} {count}
                </button>
              );
            })}
          </div>

          {error ? (
            <Card className="px-4 py-6 text-sm text-red-700">{error}</Card>
          ) : null}

          {!error && deals.length === 0 ? (
            <Card className="px-4 py-6 text-sm text-zinc-600">
              No mailbox deals in the live database yet.{" "}
              <Link href="/mailbox/connections" className="font-medium text-teal-700 hover:underline">
                Connect an inbox
              </Link>{" "}
              to start pulling mail automatically.
            </Card>
          ) : null}

          {!error && deals.length > 0 ? (
            <Card className="animate-in fade-in duration-300">
              <ul className="divide-y divide-zinc-100">
                {pageRows.map(({ deal, pos }) => {
                  const open = openId === deal.id;
                  return (
                    <li key={deal.id}>
                      <button
                        type="button"
                        className="w-full px-4 py-3 text-left transition hover:bg-zinc-50"
                        onClick={() => setOpenId(open ? null : deal.id)}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900">
                              {deal.subject || deal.id}
                            </div>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              {partyLine(deal.parties_json)}
                              {pos.length
                                ? ` · PO ${pos.slice(0, 3).join(", ")}`
                                : ""}
                              {deal.date_end
                                ? ` · ${deal.date_end.slice(0, 10)}`
                                : ""}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge>{stageLabel(deal.primary_stage)}</Badge>
                            <Badge tone={statusTone(deal.status)}>
                              {deal.status || "queued"}
                            </Badge>
                          </div>
                        </div>
                      </button>
                      {open ? (
                        <div className="space-y-1 border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                          <p>
                            {deal.summary ||
                              deal.error ||
                              "No worker summary yet."}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {deal.message_count ?? 0} messages ·{" "}
                            {deal.doc_count ?? 0} docs
                            {deal.slot ? ` · ${deal.slot}` : ""}
                            {deal.agent_id ? ` · ${deal.agent_id}` : ""}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-zinc-100 px-4 pb-4">
                <PaginationBar
                  page={safePage}
                  pageSize={PAGE_SIZE}
                  total={deals.length}
                  onPageChange={setPage}
                />
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
