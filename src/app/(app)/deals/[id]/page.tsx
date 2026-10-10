"use client";

import { useEffect, useState } from "react";
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
import { STAGE_LABELS, type SourceMessage } from "@/types/trade";
import { DealAttentionPanel } from "@/components/ops/deal-attention-panel";
import { DealTimeline } from "@/components/ops/deal-timeline";
import { SourceEmailsPanel } from "@/components/ops/source-emails-panel";
import { FactoryRecommendations } from "@/components/ops/factory-recommendations";
import { OpenableFileLink } from "@/components/ops/openable-file-link";
import { DealPaymentsPanel } from "@/components/ops/deal-payments-panel";
import { DealOverviewCard } from "@/components/ops/deal-overview-card";
import { dealCommercialModel } from "@/lib/trade/commercialModel";

export default function DealRoomPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id || "");
  const deal = useTradeStore((s) =>
    s.deals.find((d) => d.id === id || d.id === params.id),
  );
  const updateDeal = useTradeStore((s) => s.updateDeal);
  const deleteDeal = useTradeStore((s) => s.deleteDeal);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceMessage[]>(deal?.sources || []);

  useEffect(() => {
    setSources(deal?.sources || []);
  }, [deal?.id, deal?.sources]);

  useEffect(() => {
    if (!deal?.mailboxSourceId) return;
    let cancelled = false;
    async function loadEvidence() {
      setEvidenceLoading(true);
      setEvidenceError(null);
      try {
        const res = await fetch(
          `/api/processed-deals/evidence?id=${encodeURIComponent(deal!.mailboxSourceId!)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          error?: string;
          sources?: SourceMessage[];
          result?: Record<string, unknown>;
          document_url?: string;
          document_name?: string;
        };
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelled) return;
        if (body.sources?.length) {
          setSources(body.sources);
          const docFromSources = body.sources
            .flatMap((s) => s.attachments || [])
            .find((a) => a.url || a.samplePath);
          updateDeal(deal!.id, {
            sources: body.sources,
            agentResult: body.result || deal!.agentResult,
            documents:
              body.document_name || body.document_url || docFromSources
                ? [
                    {
                      id: `${deal!.id}-doc`,
                      name:
                        body.document_name ||
                        docFromSources?.name ||
                        "attachment",
                      type: deal!.documents[0]?.type || "other",
                      uploadedAt: deal!.updatedAt,
                      url: body.document_url || docFromSources?.url || undefined,
                      samplePath: docFromSources?.samplePath,
                      extractedBy: deal!.mailboxSlot,
                      extractedSummary: deal!.agentResult
                        ? String(
                            (deal!.agentResult as { summary?: string }).summary ||
                              "",
                          ).slice(0, 220)
                        : undefined,
                    },
                  ]
                : deal!.documents,
          });
        } else if (!cancelled) {
          setEvidenceError("No source emails found for this deal");
        }
      } catch (err) {
        if (!cancelled) {
          setEvidenceError(
            err instanceof Error ? err.message : "Evidence load failed",
          );
        }
      } finally {
        if (!cancelled) setEvidenceLoading(false);
      }
    }
    void loadEvidence();
    return () => {
      cancelled = true;
    };
  }, [deal?.id, deal?.mailboxSourceId, updateDeal]);

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

  const model = dealCommercialModel(deal);

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
        <Badge tone={model === "trader_principal" ? "warning" : "success"}>
          {model === "trader_principal"
            ? "Trader · Global Praise"
            : "Agency · SNSPL referee"}
        </Badge>
        {deal.mailboxSlot ? <Badge>{deal.mailboxSlot}</Badge> : null}
        {deal.mailboxSourceId ? (
          <span className="font-mono text-[11px] text-zinc-500">
            {deal.mailboxSourceId}
          </span>
        ) : null}
      </div>

      <div className="mb-4">
        <DealOverviewCard deal={deal} sources={sources} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Timeline"
            description={`${(deal.timeline || []).length} events across the thread · Day N from deal open`}
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
        <div className="space-y-2">
          {evidenceLoading ? (
            <p className="text-xs text-zinc-500">Loading source emails…</p>
          ) : null}
          {evidenceError ? (
            <p className="text-xs text-amber-700">
              Evidence: {evidenceError} (showing preview if available)
            </p>
          ) : null}
          <SourceEmailsPanel
            sources={sources}
            title="Source emails & evidence"
          />
        </div>
        <Card>
          <CardHeader
            title="Agent extract"
            description={
              deal.mailboxSlot
                ? `Worker · ${deal.mailboxSlot}`
                : "Structured fields returned by the agent"
            }
          />
          {deal.agentResult ? (
            <pre className="max-h-[32rem] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap">
              {JSON.stringify(deal.agentResult, null, 2)}
            </pre>
          ) : (
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
          )}
        </Card>
      </div>
    </div>
  );
}
