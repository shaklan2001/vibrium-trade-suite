"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import type { SourceMessage } from "@/types/trade";
import { DealAttentionPanel } from "@/components/ops/deal-attention-panel";
import { DealTimeline } from "@/components/ops/deal-timeline";
import { SourceEmailsPanel } from "@/components/ops/source-emails-panel";
import { FactoryRecommendations } from "@/components/ops/factory-recommendations";
import { OpenableFileLink } from "@/components/ops/openable-file-link";
import { DealPaymentLedger } from "@/components/ops/deal-payment-ledger";
import { DealPaymentsPanel } from "@/components/ops/deal-payments-panel";
import { DealOverviewCard } from "@/components/ops/deal-overview-card";
import { DealNextAction } from "@/components/ops/deal-next-action";
import { DealNotes } from "@/components/ops/deal-notes";
import { DealPoCheck } from "@/components/ops/deal-po-check";
import { dealCommercialModel } from "@/lib/trade/commercialModel";
import { BookSwitch } from "@/components/ops/book-switch";
import { findDealByRef } from "@/lib/trade/dealLink";
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

function recordReadLabel(iso: string | undefined, now: number): string | null {
  const readAt = Date.parse(iso || "");
  if (!Number.isFinite(readAt)) return null;
  const minutes = Math.max(0, Math.round((now - readAt) / 60_000));
  if (minutes < 1) return "Record read just now";
  if (minutes < 90) return `Record read ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Record read ${hours} h ago`;
  return `Record read ${iso!.slice(0, 10)}`;
}

export default function DealRoomPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id || "");
  const deal = useTradeStore((s) =>
    // Full id, or the short /deals/<code>~<hash> key the Copilot links with.
    findDealByRef(s.deals, id) || s.deals.find((d) => d.id === params.id),
  );
  const updateDeal = useTradeStore((s) => s.updateDeal);
  const deleteDeal = useTradeStore((s) => s.deleteDeal);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceMessage[]>(deal?.sources || []);
  const [readLabel, setReadLabel] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => setNow(Date.now()), []);

  useEffect(() => {
    setReadLabel(recordReadLabel(deal?.recordAsOf, Date.now()));
  }, [deal?.recordAsOf]);

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
  const buyer = dealBuyer(deal);
  const supplier = dealSupplier(deal);
  const value = dealValueUsd(deal);
  const route = [deal.booking?.pol, deal.booking?.pod].filter(Boolean).join(" to ");
  const lastMail = dealLastActivity(deal);
  const facts: { label: string; value: string; muted?: boolean }[] = [
    { label: "Buyer", value: buyer || "Not in email yet", muted: !buyer },
    { label: "Supplier", value: supplier || "Not in email yet", muted: !supplier },
    { label: "Order value", value: value ? compactUsd(value) : "Not found", muted: !value },
    { label: "Route", value: route || "Not booked", muted: !route },
    { label: "Sails", value: deal.booking?.etd || "No date", muted: !deal.booking?.etd },
    { label: "Last email", value: relativeDay(lastMail, now), muted: !lastMail },
  ];

  return (
    <div className="deal-room">
      <Link href="/deals" className="deal-back">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Deal Board
      </Link>

      <header className="deal-hero">
        <div className="deal-hero-top">
          <div className="deal-hero-main">
            <div className="deal-row-top">
              <span className="deal-code-chip">{deal.code}</span>
              <ModelTag model={model} />
              <BookSwitch
                deal={deal}
                onChange={(next, pinned) =>
                  updateDeal(deal.id, { commercialModel: next, commercialModelPinned: pinned })
                }
              />
              {readLabel ? <span className="deal-hero-read">{readLabel}</span> : null}
            </div>
            <h1 className="deal-hero-title">{dealHeadline(deal)}</h1>
            <p className="deal-hero-summary">{deal.title}</p>
          </div>
          <div className="deal-hero-actions">
            <Link href="/outreach">
              <Button>Outreach</Button>
            </Link>
            <Link href="/quotes">
              <Button variant="secondary">Quotes</Button>
            </Link>
            <Link href="/pipeline">
              <Button variant="secondary">Pipeline</Button>
            </Link>
          </div>
        </div>
        <StageProgress stage={deal.stage} size="lg" />
        <dl className="deal-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className={f.muted ? "is-missing" : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="deal-layout">
        <div className="deal-main">
          <DealNextAction deal={deal} />
          <DealOverviewCard deal={deal} sources={sources} />
          <DealPoCheck deal={deal} />
          <DealPaymentLedger deal={deal} />
          <DealPaymentsPanel deal={deal} />

          <Card>
            <CardHeader
              title="Timeline"
              description={`${(deal.timeline || []).length} events in this thread`}
            />
            <DealTimeline createdAt={deal.createdAt} events={deal.timeline} />
          </Card>

          <div className="space-y-2">
            {evidenceLoading ? (
              <p className="text-xs text-zinc-500">Loading source emails…</p>
            ) : null}
            {evidenceError ? (
              <p className="text-xs text-amber-700">
                Couldn&apos;t load the full emails: {evidenceError}. Showing the preview.
              </p>
            ) : null}
            <SourceEmailsPanel sources={sources} title="Source emails" />
          </div>

          <details className="deal-raw">
            <summary>Raw agent extract</summary>
            <p className="deal-raw-note">
              What the agent returned, for checking a figure.
              {deal.mailboxSlot ? ` Worker: ${deal.mailboxSlot}.` : ""}
              {deal.mailboxSourceId ? ` Record: ${deal.mailboxSourceId}.` : ""}
            </p>
            {deal.agentResult ? (
              <pre>{JSON.stringify(deal.agentResult, null, 2)}</pre>
            ) : (
              <ul>
                <li>Artwork: {deal.artwork?.summary || "—"}</li>
                <li>Samples: {deal.samples?.summary || "—"}</li>
                <li>
                  PI/PO:{" "}
                  {deal.discrepancy?.summary || deal.pi?.summary || deal.po?.summary || "—"}
                </li>
                <li>Packaging: {deal.packaging?.summary || deal.upcMatch?.summary || "—"}</li>
                <li>Production: {deal.production?.summary || "—"}</li>
                <li>Booking: {deal.booking?.summary || "—"}</li>
                <li>Payment: {deal.payment?.summary || "—"}</li>
                <li>Commission: {deal.commission?.summary || "—"}</li>
              </ul>
            )}
          </details>
        </div>

        <aside className="deal-side">
          <DealAttentionPanel deal={deal} />

          <Card>
            <CardHeader title="Parties" />
            <ul className="deal-parties">
              {deal.parties.length === 0 ? (
                <li className="is-missing">No parties found in the emails yet.</li>
              ) : (
                deal.parties.map((p, i) => (
                  <li key={i}>
                    <span className="deal-party-role">{p.role}</span>
                    <span className="deal-party-name">{p.company || p.name}</span>
                    {p.company && p.name && p.name !== p.company ? (
                      <span className="deal-party-sub">{p.name}</span>
                    ) : null}
                    {p.email ? <span className="deal-party-sub">{p.email}</span> : null}
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              description={`${deal.documents.length} file${deal.documents.length === 1 ? "" : "s"}`}
            />
            <ul className="deal-docs">
              {deal.documents.length === 0 ? (
                <li className="is-missing">No files attached yet.</li>
              ) : (
                deal.documents.map((doc) => (
                  <li key={doc.id}>
                    <div className="deal-doc-top">
                      <OpenableFileLink name={doc.name} samplePath={doc.samplePath} url={doc.url} />
                      <span className="deal-doc-type">{doc.type.replaceAll("_", " ")}</span>
                    </div>
                    {doc.extractedSummary ? (
                      <p className="deal-doc-summary">{doc.extractedSummary}</p>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </Card>

          {deal.mailboxSourceId ? <DealNotes dealKey={deal.mailboxSourceId} /> : null}

          {deal.requirement ? (
            <Card>
              <CardHeader title="Requirement" />
              <dl className="deal-req">
                <div>
                  <dt>Category</dt>
                  <dd>{deal.requirement.productCategory || "—"}</dd>
                </div>
                <div>
                  <dt>Target cost</dt>
                  <dd>
                    {deal.requirement.targetFactoryCost != null
                      ? `$${deal.requirement.targetFactoryCost}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Retail</dt>
                  <dd>
                    {deal.requirement.targetRetailPrice != null
                      ? `$${deal.requirement.targetRetailPrice}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </Card>
          ) : null}

          <FactoryRecommendations requirement={deal.requirement} deal={deal} />

          <button
            type="button"
            className="deal-delete"
            onClick={() => {
              const ok = window.confirm(
                `Remove ${deal.code} from the board? This can't be undone here.`,
              );
              if (!ok) return;
              deleteDeal(deal.id);
              window.location.href = "/deals";
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Remove deal
          </button>
        </aside>
      </div>
    </div>
  );
}
