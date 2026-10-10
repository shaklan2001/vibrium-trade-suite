"use client";

import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  ChannelBadge,
  Stat,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import {
  hydrateMailboxBook,
  friendlyMailboxError,
} from "@/lib/trade/mailboxHydrate";
import { STAGE_LABELS, ALL_STAGES } from "@/types/trade";
import { dealCommercialModel } from "@/lib/trade/commercialModel";

export default function DealsPage() {
  const deals = useVisibleDeals();
  const createDeal = useTradeStore((s) => s.createDeal);
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const stageFilter = useTradeStore((s) => s.stageFilter);
  const setStageFilter = useTradeStore((s) => s.setStageFilter);
  const productionDueFilter = useTradeStore((s) => s.productionDueFilter);
  const setProductionDueFilter = useTradeStore((s) => s.setProductionDueFilter);

  return (
    <div>
      <PageHeader
        title="Deal Board"
        description={
          filter === "all"
            ? "Open book of business — filter Agency vs Trader in the header."
            : filter === "trader_principal"
              ? "Trader principal book (Global Praise) — mailbox deals only for this filter."
              : "Agency commission book (SNSPL referee)."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void hydrateMailboxBook().then((r) => {
                  if (r.error) {
                    toast.error(friendlyMailboxError(r.error));
                    return;
                  }
                  toast.success(`Loaded ${r.count} mailbox deals`);
                });
              }}
            >
              Load mailbox
            </Button>
            <Button
              onClick={() => {
                const d = createDeal({
                  title: "New sourcing deal",
                  stage: "requirement",
                });
                window.location.href = `/deals/${d.id}`;
              }}
            >
              New deal
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Stage
          </span>
          <select
            className="bg-transparent text-sm font-medium text-zinc-900 outline-none"
            value={stageFilter}
            onChange={(e) =>
              setStageFilter(e.target.value as typeof stageFilter)
            }
            aria-label="Filter by stage"
          >
            <option value="all">All stages</option>
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Due ≤
          </span>
          <select
            className="bg-transparent text-sm font-medium text-zinc-900 outline-none"
            value={String(productionDueFilter)}
            onChange={(e) => {
              const v = e.target.value;
              setProductionDueFilter(
                v === "all"
                  ? "all"
                  : (Number(v) as 15 | 30 | 45 | 60 | 90),
              );
            }}
            aria-label="Production due window"
          >
            <option value="all">Any</option>
            <option value="15">15 days</option>
            <option value="30">30 days</option>
            <option value="45">45 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </label>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Open deals" value={deals.length} />
        <Stat
          label="In outreach"
          value={deals.filter((d) => d.stage === "outreach").length}
        />
        <Stat
          label="In production+"
          value={deals.filter((d) =>
            ["production", "booking", "docs_payment"].includes(d.stage),
          ).length}
        />
        <Stat
          label="With sources"
          value={deals.filter((d) => (d.sources || []).length > 0).length}
        />
      </div>

      {deals.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">
          No deals match these filters.{" "}
          <button
            className="text-teal-700 underline"
            onClick={() => {
              void hydrateMailboxBook().then((r) => {
                if (r.error) toast.error(friendlyMailboxError(r.error));
                else toast.success(`Loaded ${r.count} mailbox deals`);
              });
            }}
          >
            Load mailbox
          </button>
        </Card>
      ) : (
        <div className="space-y-2">
          {deals.map((d) => (
            <Link key={d.id} href={`/deals/${encodeURIComponent(d.id)}`}>
              <Card className="mb-2 flex items-center justify-between gap-3 px-4 py-3 transition hover:border-teal-300">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
                      {d.code}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {d.title}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                    <Badge>{STAGE_LABELS[d.stage]}</Badge>
                    {d.mailboxIngest ? (
                      <Badge
                        tone={
                          dealCommercialModel(d) === "trader_principal"
                            ? "warning"
                            : "info"
                        }
                      >
                        {dealCommercialModel(d) === "trader_principal"
                          ? "Trader"
                          : "Agency"}
                      </Badge>
                    ) : null}
                    {(d.sources || []).length > 0 ? (
                      <span>
                        {d.sources.length} sources
                        {d.documents.length
                          ? ` · ${d.documents.length} files`
                          : ""}
                      </span>
                    ) : null}
                    {d.timeline[0] ? (
                      <span className="inline-flex items-center gap-1">
                        <ChannelBadge channel={d.timeline[0].channel} />
                        {d.timeline[0].title}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-teal-700">Open →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
