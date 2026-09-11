"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { STAGE_LABELS } from "@/types/trade";
import { DealAttentionPanel } from "@/components/ops/deal-attention-panel";
import { DealTimeline } from "@/components/ops/deal-timeline";
import { SourceEmailsPanel } from "@/components/ops/source-emails-panel";
import { FactoryRecommendations } from "@/components/ops/factory-recommendations";
import { OpenableFileLink } from "@/components/ops/openable-file-link";
import { DealPaymentsPanel } from "@/components/ops/deal-payments-panel";

export default function DealRoomPage() {
  const params = useParams<{ id: string }>();
  const deal = useTradeStore((s) => s.deals.find((d) => d.id === params.id));
  const deleteDeal = useTradeStore((s) => s.deleteDeal);

  if (!deal) {
    return (
      <div>
        <PageHeader title="Deal not found" />
        <Link href="/deals" className="text-sm text-teal-700 underline">
          Back to board
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={deal.title}
        description={`${deal.code} · ${STAGE_LABELS[deal.stage]}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/home">
              <Button variant="ghost">Command Center</Button>
            </Link>
            <Link href="/pipeline">
              <Button variant="secondary">Pipeline</Button>
            </Link>
            <Link href="/quotes">
              <Button variant="secondary">Quotes</Button>
            </Link>
            <Link href="/outreach">
              <Button>Outreach</Button>
            </Link>
            <Button
              variant="danger"
              onClick={() => {
                deleteDeal(deal.id);
                window.location.href = "/deals";
              }}
            >
              Delete
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-zinc-900 px-2.5 py-1 font-mono text-sm font-semibold text-white">
          {deal.code}
        </span>
        <Badge tone="info">{STAGE_LABELS[deal.stage]}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Timeline"
            description="Day count from deal open · dates highlighted"
          />
          <DealTimeline createdAt={deal.createdAt} events={deal.timeline} />
        </Card>

        <div className="space-y-4">
          <DealAttentionPanel deal={deal} />
          <FactoryRecommendations requirement={deal.requirement} deal={deal} />

          <Card>
            <CardHeader title="Parties" />
            <div className="space-y-2 px-4 py-3">
              {deal.parties.map((p, i) => (
                <div key={i} className="text-sm">
                  <Badge>{p.role}</Badge>{" "}
                  <span className="font-medium">{p.name}</span>
                  {p.company ? (
                    <span className="text-zinc-500"> · {p.company}</span>
                  ) : null}
                  {p.email ? (
                    <div className="text-xs text-zinc-500">{p.email}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Requirement" />
            <div className="space-y-1 px-4 py-3 text-sm">
              {deal.requirement ? (
                <>
                  <div>
                    <span className="text-zinc-500">Category:</span>{" "}
                    {deal.requirement.productCategory}
                  </div>
                  <div>
                    <span className="text-zinc-500">Target cost:</span>{" "}
                    {deal.requirement.targetFactoryCost != null
                      ? `$${deal.requirement.targetFactoryCost}`
                      : "—"}
                  </div>
                  <div>
                    <span className="text-zinc-500">Retail:</span>{" "}
                    {deal.requirement.targetRetailPrice != null
                      ? `$${deal.requirement.targetRetailPrice}`
                      : "—"}
                  </div>
                </>
              ) : (
                <p className="text-zinc-500">Not extracted yet</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Documents" description="Open source files" />
            <div className="space-y-2 px-4 py-3 text-sm">
              {deal.documents.length === 0 ? (
                <p className="text-zinc-500">None</p>
              ) : (
                deal.documents.map((doc) => (
                  <div key={doc.id} className="flex flex-col gap-0.5">
                    <div className="flex justify-between gap-2">
                      <OpenableFileLink
                        name={doc.name}
                        samplePath={doc.samplePath}
                        url={doc.url}
                      />
                      <Badge>{doc.type}</Badge>
                    </div>
                    {doc.extractedBy || doc.extractedSummary ? (
                      <p className="text-[11px] text-zinc-500">
                        {doc.extractedBy ? (
                          <span className="font-medium text-zinc-700">
                            {doc.extractedBy}
                          </span>
                        ) : null}
                        {doc.extractedSummary
                          ? `${doc.extractedBy ? " — " : ""}${doc.extractedSummary}`
                          : null}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <DealPaymentsPanel deal={deal} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SourceEmailsPanel sources={deal.sources || []} />
        <Card>
          <CardHeader title="Stage snapshot" />
          <div className="space-y-1 px-4 py-3 text-xs text-zinc-600">
            <div>Artwork: {deal.artwork?.summary || "—"}</div>
            <div>Samples: {deal.samples?.summary || "—"}</div>
            <div>
              PI/PO:{" "}
              {deal.discrepancy?.summary ||
                deal.pi?.summary ||
                deal.po?.summary ||
                "—"}
            </div>
            <div>
              Packaging:{" "}
              {deal.packaging?.summary || deal.upcMatch?.summary || "—"}
            </div>
            <div>Production: {deal.production?.summary || "—"}</div>
            <div>Booking: {deal.booking?.summary || "—"}</div>
            <div>Payment: {deal.payment?.summary || "—"}</div>
            <div>Commission: {deal.commission?.summary || "—"}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
