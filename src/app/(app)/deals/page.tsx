"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  ChannelBadge,
  Input,
  Stat,
} from "@/components/ui/primitives";
import { LoadingBlock, ListSkeleton } from "@/components/ui/loading-block";
import { PaginationBar } from "@/components/ui/pagination";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import {
  hydrateMailboxBook,
  friendlyMailboxError,
} from "@/lib/trade/mailboxHydrate";
import { STAGE_LABELS, ALL_STAGES } from "@/types/trade";
import { dealCommercialModel } from "@/lib/trade/commercialModel";

const PAGE_SIZE = 25;

export default function DealsPage() {
  const deals = useVisibleDeals();
  const createDeal = useTradeStore((s) => s.createDeal);
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const stageFilter = useTradeStore((s) => s.stageFilter);
  const setStageFilter = useTradeStore((s) => s.setStageFilter);
  const productionDueFilter = useTradeStore((s) => s.productionDueFilter);
  const setProductionDueFilter = useTradeStore((s) => s.setProductionDueFilter);
  const searchQuery = useTradeStore((s) => s.dealsSearchQuery);
  const setSearchQuery = useTradeStore((s) => s.setDealsSearchQuery);
  const mailboxStatus = useTradeStore((s) => s.mailboxBookStatus);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, stageFilter, productionDueFilter, filter]);

  useEffect(() => {
    if (mailboxStatus === "idle") {
      void hydrateMailboxBook();
    }
  }, [mailboxStatus]);

  const pageCount = Math.max(1, Math.ceil(deals.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageDeals = useMemo(
    () => deals.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [deals, safePage],
  );

  // Only treat empty as "still loading" when hydrate has not finished.
  const showLoader =
    (mailboxStatus === "idle" || mailboxStatus === "loading") &&
    deals.length === 0;

  return (
    <div>
      <PageHeader
        title="Deal Board"
        description={
          filter === "all"
            ? "Open book of business — search by deal, party, or team email (e.g. kalpana)."
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
              Refresh mailbox
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

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deal, party, email, team (kalpana…)"
            className="pl-9"
            aria-label="Search deals"
          />
        </label>
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

      {showLoader ? (
        <>
          <LoadingBlock label="Loading deal board…" className="mb-4" />
          <ListSkeleton rows={5} />
        </>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Matching deals" value={deals.length} />
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
              {searchQuery.trim()
                ? `No deals match “${searchQuery.trim()}”.`
                : "No deals match these filters."}{" "}
              <button
                className="text-teal-700 underline"
                onClick={() => {
                  setSearchQuery("");
                  void hydrateMailboxBook().then((r) => {
                    if (r.error) toast.error(friendlyMailboxError(r.error));
                    else toast.success(`Loaded ${r.count} mailbox deals`);
                  });
                }}
              >
                Clear search / refresh
              </button>
            </Card>
          ) : (
            <div className="space-y-2 animate-in fade-in duration-300">
              {pageDeals.map((d) => {
                const emails = [
                  ...new Set(
                    [
                      ...d.parties.map((p) => p.email).filter(Boolean),
                      ...d.sources
                        .flatMap((s) => [s.from, s.to])
                        .filter(Boolean),
                    ].filter(Boolean) as string[],
                  ),
                ].slice(0, 2);
                return (
                  <Link key={d.id} href={`/deals/${encodeURIComponent(d.id)}`}>
                    <Card className="mb-2 flex items-center justify-between gap-3 px-4 py-3 transition hover:border-teal-300 hover:shadow-sm">
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
                          {emails.length ? (
                            <span className="truncate">{emails.join(" · ")}</span>
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
                      <span className="shrink-0 text-xs text-teal-700">
                        Open →
                      </span>
                    </Card>
                  </Link>
                );
              })}
              <PaginationBar
                page={safePage}
                pageSize={PAGE_SIZE}
                total={deals.length}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
