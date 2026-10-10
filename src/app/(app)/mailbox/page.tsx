"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Card, Stat } from "@/components/ui/primitives";

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
  cost_usd?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
};

type Counts = {
  total: number;
  byStage: Record<string, number>;
  byStatus: Record<string, number>;
  spendUsd?: number;
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
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_note?: string;
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

function formatUsd(value: number | null | undefined) {
  const n = Number(value || 0);
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
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

export default function MailboxPage() {
  const [stage, setStage] = useState<(typeof STAGE_FILTERS)[number]>("all");
  const [deals, setDeals] = useState<ProcessedDeal[]>([]);
  const [counts, setCounts] = useState<Counts>({
    total: 0,
    byStage: {},
    byStatus: {},
    spendUsd: 0,
  });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load(first = false) {
      const qs = stage === "all" ? "" : `?stage=${stage}`;
      try {
        const res = await fetch(`/api/processed-deals${qs}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setDeals(body.deals || []);
        setCounts(
          body.counts || { total: 0, byStage: {}, byStatus: {}, spendUsd: 0 },
        );
        setProgress(body.progress || null);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    }
    void load(true);
    const poll = window.setInterval(() => void load(false), 4000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [stage]);

  const completed = counts.byStatus.completed ?? 0;
  const failed = counts.byStatus.failed ?? 0;
  const live = Boolean(progress?.running);
  const target = progress?.target || 0;
  const doneN = (progress?.completed || 0) + (progress?.failed || 0);
  const pct = target ? Math.min(100, Math.round((doneN / target) * 100)) : 0;
  const stale =
    live &&
    progress?.updated_at &&
    now - new Date(progress.updated_at).getTime() > 90_000;

  const rows = useMemo(
    () =>
      deals.map((deal) => {
        const pos = Array.isArray(deal.po_numbers) ? deal.po_numbers : [];
        return { deal, pos };
      }),
    [deals],
  );

  return (
    <div>
      <PageHeader
        title="Mailbox book"
        description="Shared Outlook ingest. Refresh this page anytime — progress, cost, and extracted deals come from Neon, not browser storage."
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
              className="h-full bg-teal-700 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-4">
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {formatUsd(progress.cost_usd)}
              </div>
              <div className="text-xs text-zinc-500">This run (metered)</div>
            </div>
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
                {(progress.input_tokens || 0).toLocaleString()} /{" "}
                {(progress.output_tokens || 0).toLocaleString()}
              </div>
              <div className="text-xs text-zinc-500">In / out tokens</div>
            </div>
          </div>
          {progress.cost_note ? (
            <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500">
              {progress.cost_note}
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Processed deals" value={counts.total} />
        <Stat label="Completed" value={completed} />
        <Stat label="Failed" value={failed} />
        <Stat
          label="Lifetime LLM cost"
          value={formatUsd(counts.spendUsd)}
        />
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
                  ? "rounded-full bg-teal-700 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
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

      {!error && !loading && deals.length === 0 ? (
        <Card className="px-4 py-6 text-sm text-zinc-600">
          No mailbox deals in Postgres yet. The ingest runner writes here as
          each worker finishes.
        </Card>
      ) : null}

      {!error && deals.length > 0 ? (
        <Card>
          <ul className="divide-y divide-zinc-100">
            {rows.map(({ deal, pos }) => {
              const open = openId === deal.id;
              return (
                <li key={deal.id}>
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left hover:bg-zinc-50"
                    onClick={() => setOpenId(open ? null : deal.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900">
                          {deal.subject || deal.id}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {partyLine(deal.parties_json)}
                          {pos.length ? ` · PO ${pos.slice(0, 3).join(", ")}` : ""}
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
                        {deal.cost_usd ? (
                          <span className="text-[11px] tabular-nums text-zinc-500">
                            {formatUsd(deal.cost_usd)}
                          </span>
                        ) : null}
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
                        {deal.cost_usd != null
                          ? ` · ${formatUsd(deal.cost_usd)}`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
