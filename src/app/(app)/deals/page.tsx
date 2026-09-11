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
import { STAGE_LABELS, ALL_STAGES } from "@/types/trade";

export default function DealsPage() {
  const deals = useTradeStore((s) => s.deals);
  const createDeal = useTradeStore((s) => s.createDeal);
  const loadShowcaseDeal = useTradeStore((s) => s.loadShowcaseDeal);
  const seedBookOfBusiness = useTradeStore((s) => s.seedBookOfBusiness);

  return (
    <div>
      <PageHeader
        title="Deal Board"
        description="Open book of business — every deal carries a code and source emails through the full sourcing loop."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const { added, total } = seedBookOfBusiness();
                toast.success(
                  added
                    ? `Loaded ${added} deals (${total} in portfolio)`
                    : `Portfolio already loaded (${total})`,
                );
              }}
            >
              Load portfolio
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const d = loadShowcaseDeal();
                window.location.href = `/deals/${d.id}`;
              }}
            >
              Open flagship deal
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

      <div className="mb-6 flex flex-wrap gap-1.5 text-xs text-zinc-500">
        Stages:
        {ALL_STAGES.map((s) => (
          <Badge key={s} tone="neutral">
            {STAGE_LABELS[s]}
          </Badge>
        ))}
      </div>

      {deals.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">
          No deals yet.{" "}
          <button
            className="text-teal-700 underline"
            onClick={() => seedBookOfBusiness()}
          >
            Load portfolio
          </button>{" "}
          or start from intake.
        </Card>
      ) : (
        <div className="space-y-2">
          {deals.map((d) => (
            <Link key={d.id} href={`/deals/${d.id}`}>
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
