"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  ChannelBadge,
  Stat,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { STAGE_LABELS, PHASE_A_STAGES, type DealStage } from "@/types/trade";

export default function DealsPage() {
  const deals = useTradeStore((s) => s.deals);
  const createDeal = useTradeStore((s) => s.createDeal);

  return (
    <div>
      <PageHeader
        title="Deal Board"
        description="Phase A stages: requirement → outreach → quoting → selection. Later stages are visible but not automated yet."
        actions={
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
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Open deals" value={deals.length} />
        <Stat
          label="In outreach"
          value={deals.filter((d) => d.stage === "outreach").length}
        />
        <Stat
          label="Quoting"
          value={deals.filter((d) => d.stage === "quoting").length}
        />
        <Stat
          label="Selection locked"
          value={deals.filter((d) => d.selectionLocked).length}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5 text-xs text-zinc-500">
        Later (not automated yet):
        {(
          [
            "artwork",
            "samples",
            "pi_po",
            "packaging",
            "production",
            "booking",
            "docs_payment",
          ] as DealStage[]
        ).map((s) => (
          <Badge key={s} tone="warning">
            {STAGE_LABELS[s]}
          </Badge>
        ))}
      </div>

      <div className="grid gap-3">
        {deals.length === 0 ? (
          <Card className="p-8 text-center text-sm text-zinc-500">
            No deals yet.{" "}
            <Link href="/intake" className="text-teal-700 underline">
              Start with requirement intake
            </Link>
            .
          </Card>
        ) : (
          deals.map((d) => (
            <Link key={d.id} href={`/deals/${d.id}`}>
              <Card className="p-4 transition hover:border-teal-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{d.title}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Updated {new Date(d.updatedAt).toLocaleString()}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge
                        tone={
                          PHASE_A_STAGES.includes(d.stage) ? "info" : "warning"
                        }
                      >
                        {STAGE_LABELS[d.stage as DealStage]}
                      </Badge>
                      {d.quote ? (
                        <Badge tone="neutral">
                          {d.quote.skus.length} SKUs
                        </Badge>
                      ) : null}
                      {d.outreach[0] ? (
                        <ChannelBadge channel={d.outreach[0].channel} />
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right text-xs text-zinc-500">
                    {d.parties.map((p) => p.name).join(" · ")}
                  </div>
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
