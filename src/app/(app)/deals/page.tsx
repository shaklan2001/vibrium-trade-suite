"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Button, Input } from "@/components/ui/primitives";
import { ListSkeleton } from "@/components/ui/loading-block";
import { PaginationBar } from "@/components/ui/pagination";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import {
  hydrateMailboxBook,
  friendlyMailboxError,
} from "@/lib/trade/mailboxHydrate";
import { STAGE_LABELS, ALL_STAGES } from "@/types/trade";
import { dealCommercialModel } from "@/lib/trade/commercialModel";
import { Select } from "@/components/ui/select";
import { StatTile } from "@/components/ops/command-center-home";
import { ModelTag, StageProgress } from "@/components/ops/deal-ui";
import {
  compactUsd,
  dealBuyer,
  dealHeadline,
  dealLastActivity,
  dealSupplier,
  dealValueUsd,
  relativeDay,
} from "@/lib/trade/dealDisplay";

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

  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);

  const boardStats = useMemo(() => {
    const sourcing = new Set(["requirement", "outreach", "quoting", "selection", "artwork", "samples"]);
    const production = new Set(["pi_po", "packaging", "production"]);
    const shipping = new Set(["booking", "docs_payment"]);
    let a = 0, b = 0, c = 0, v = 0;
    for (const d of deals) {
      if (sourcing.has(d.stage)) a += 1;
      else if (production.has(d.stage)) b += 1;
      else if (shipping.has(d.stage)) c += 1;
      if (dealValueUsd(d)) v += 1;
    }
    return { sourcing: a, production: b, shipping: c, withValue: v };
  }, [deals]);

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
                void hydrateMailboxBook({ force: true }).then((r) => {
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
            className="pl-9!"
            aria-label="Search deals"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Select<typeof stageFilter>
            variant="chip"
            label="Stage"
            value={stageFilter}
            onChange={setStageFilter}
            aria-label="Filter by stage"
            className="h-10"
            options={[
              { value: "all", label: "All stages" },
              ...ALL_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
            ]}
          />
          <Select
            variant="chip"
            label="Due ≤"
            value={String(productionDueFilter)}
            onChange={(v) =>
              setProductionDueFilter(
                v === "all" ? "all" : (Number(v) as 15 | 30 | 45 | 60 | 90),
              )
            }
            aria-label="Production due window"
            className="h-10"
            options={[
              { value: "all", label: "Any" },
              ...[15, 30, 45, 60, 90].map((d) => ({
                value: String(d),
                label: `${d} days`,
              })),
            ]}
          />
        </div>
      </div>

      {showLoader ? (
        <>
          <div className="cc-tiles cc-tiles-4 mb-5" role="status" aria-label="Loading deals">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="cc-sk cc-sk-tile" />
            ))}
          </div>
          <ListSkeleton rows={8} />
        </>
      ) : (
        <>
          <div className="cc-tiles cc-tiles-4 mb-5">
            <StatTile
              label="Matching deals"
              value={deals.length.toLocaleString()}
              caption={`${boardStats.withValue.toLocaleString()} with an order value`}
            />
            <StatTile
              label="Sourcing"
              value={boardStats.sourcing.toLocaleString()}
              caption="requirement to samples"
              tone="info"
            />
            <StatTile
              label="In production"
              value={boardStats.production.toLocaleString()}
              caption="PI/PO to production"
              tone="warn"
            />
            <StatTile
              label="Shipping & payment"
              value={boardStats.shipping.toLocaleString()}
              caption="booking, docs, payment"
              tone="good"
            />
          </div>

          {deals.length === 0 ? (
            <div className="cc-empty deal-empty">
              <p>
                {searchQuery.trim()
                  ? `No deals match “${searchQuery.trim()}”.`
                  : "No deals match these filters."}
              </p>
              <button
                type="button"
                className="cc-inline-link"
                onClick={() => {
                  setSearchQuery("");
                  void hydrateMailboxBook({ force: true }).then((r) => {
                    if (r.error) toast.error(friendlyMailboxError(r.error));
                    else toast.success(`Loaded ${r.count} mailbox deals`);
                  });
                }}
              >
                Clear search and reload
              </button>
            </div>
          ) : (
            <div className="deal-table">
              <div className="deal-table-head" aria-hidden>
                <span>Deal</span>
                <span>Stage</span>
                <span>Buyer and supplier</span>
                <span className="deal-col-num">Order value</span>
                <span className="deal-col-num">Last activity</span>
              </div>
              <ul className="deal-rows">
                {pageDeals.map((d) => {
                  const buyer = dealBuyer(d);
                  const supplier = dealSupplier(d);
                  const value = dealValueUsd(d);
                  const last = dealLastActivity(d);
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/deals/${encodeURIComponent(d.id)}`}
                        className="deal-row"
                      >
                        <div className="deal-cell-main">
                          <div className="deal-row-top">
                            <span className="deal-code-chip">{d.code}</span>
                            {d.mailboxIngest ? (
                              <ModelTag model={dealCommercialModel(d)} />
                            ) : null}
                          </div>
                          <span className="deal-row-title">{dealHeadline(d)}</span>
                          <span className="deal-row-summary">{d.title}</span>
                        </div>
                        <div className="deal-cell-stage">
                          <StageProgress stage={d.stage} />
                        </div>
                        <div className="deal-cell-parties">
                          <span className={buyer ? "" : "is-missing"}>
                            {buyer || "No buyer yet"}
                          </span>
                          <span className={supplier ? "" : "is-missing"}>
                            {supplier || "No supplier yet"}
                          </span>
                        </div>
                        <div className="deal-col-num deal-cell-value">
                          {value ? compactUsd(value) : <span className="is-missing">—</span>}
                        </div>
                        <div className="deal-col-num deal-cell-when">
                          <span>{relativeDay(last, now)}</span>
                          {d.sources.length ? (
                            <span className="deal-row-meta">
                              {d.sources.length} email{d.sources.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                        <ChevronRight className="deal-row-chevron" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
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
