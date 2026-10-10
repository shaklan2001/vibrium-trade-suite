"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Label,
  Textarea,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { SourceEmailsPanel } from "@/components/ops/source-emails-panel";
import {
  artworkFromWorker,
  commissionFromWorker,
  discrepancyFromWorker,
  docsPackFromWorker,
  paymentFromWorker,
  productionFromWorker,
  samplesFromWorker,
  upcFromWorker,
} from "@/lib/trade/parsersPhaseBG";
import { getExecutionResult, runWorkerAndWait } from "@/services/agentsApi";
import type { DealStage, WorkerSlot } from "@/types/trade";
import { STAGE_LABELS } from "@/types/trade";

type StageKey =
  | "artwork"
  | "samples"
  | "pi_po"
  | "packaging"
  | "production"
  | "booking"
  | "docs_payment";

const STAGES: { key: StageKey; label: string }[] = [
  { key: "artwork", label: "Artwork" },
  { key: "samples", label: "Samples" },
  { key: "pi_po", label: "PI / PO" },
  { key: "packaging", label: "Packaging" },
  { key: "production", label: "Production" },
  { key: "booking", label: "Booking" },
  { key: "docs_payment", label: "Docs & payment" },
];

export default function PipelinePage() {
  const deals = useVisibleDeals();
  const routing = useTradeStore((s) => s.routing);
  const updateDeal = useTradeStore((s) => s.updateDeal);
  const setStage = useTradeStore((s) => s.setStage);
  const addTimeline = useTradeStore((s) => s.addTimeline);
  const addSource = useTradeStore((s) => s.addSource);

  const [dealId, setDealId] = useState(deals[0]?.id || "");
  const deal = useMemo(() => deals.find((d) => d.id === dealId), [deals, dealId]);
  const [tab, setTab] = useState<StageKey>("artwork");
  const [emailText, setEmailText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function runSlot(
    slot: WorkerSlot,
    input: Record<string, unknown>,
    apply: (result: Record<string, unknown>, executionId: string) => void,
    stage?: DealStage,
  ) {
    if (!deal) {
      toast.error("Select a deal");
      return;
    }
    const agentId = routing[slot];
    if (!agentId) {
      toast.error(`Configure ${slot} in Agent Routing`);
      return;
    }
    setBusy(true);
    setStatus(`Running ${slot}…`);
    try {
      const ex = await runWorkerAndWait(agentId, input, (e) =>
        setStatus(`${slot}: ${e.status}`),
      );
      if (ex.status !== "completed") {
        throw new Error(ex.error || `Worker ${ex.status}`);
      }
      const result = getExecutionResult(ex);
      if (!result) throw new Error("Empty worker result");
      apply(result, ex.execution_id);
      if (stage) setStage(deal.id, stage);
      const emailBody =
        typeof input.email_text === "string" ? input.email_text.trim() : "";
      if (emailBody) {
        const kind =
          stage === "artwork"
            ? "artwork"
            : stage === "samples"
              ? "samples"
              : stage === "production"
                ? "production"
                : stage === "docs_payment"
                  ? "payment"
                  : "other";
        addSource(deal.id, {
          kind,
          body: emailBody,
          label: `Stage · ${slot}`,
          subject: emailBody.match(/^Subject:\s*(.+)$/im)?.[1]?.trim(),
          from: emailBody.match(/^From:\s*(.+)$/im)?.[1]?.trim(),
          extractedBy: slot,
          extractedSummary: String(result.summary || "Completed"),
          attachments: [],
        });
      }
      addTimeline(deal.id, {
        channel: "portal",
        title: `Agent · ${slot}`,
        detail: String(result.summary || "Completed"),
        meta: { executionId: ex.execution_id, slot },
      });
      setStatus(`Done · ${ex.execution_id}`);
      toast.success(`${slot} completed`);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Agent failed");
      setStatus("Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stage pipeline"
        description="Run stage workers from artwork through docs & payment against real mailbox deals. Source emails stay on the deal for audit."
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Deal</Label>
            <select
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
            >
              <option value="">Select deal…</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Current stage</Label>
            <div className="pt-2 text-sm font-medium">
              {deal ? STAGE_LABELS[deal.stage] : "—"}
            </div>
          </div>
        </div>
        {status ? <p className="mt-2 text-xs text-zinc-500">{status}</p> : null}
      </Card>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <Button
            key={s.key}
            variant={tab === s.key ? "primary" : "secondary"}
            onClick={() => setTab(s.key)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Agent input"
            description="Email / notes for this stage — originals stay on the deal for audit"
          />
          <div className="space-y-3 p-4">
            <Textarea
              rows={12}
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste a real stage email or notes for this deal…"
            />
            {deal ? (
              <p className="text-[11px] text-zinc-500">
                Deal {deal.code} keeps source emails in the deal room.
              </p>
            ) : null}
            {tab === "artwork" ? (
              <Button
                disabled={busy || !deal}
                onClick={() =>
                  void runSlot(
                    "artwork_checklist_extractor",
                    { email_text: emailText },
                    (r, id) =>
                      updateDeal(deal!.id, {
                        artwork: artworkFromWorker(r, id),
                      }),
                    "artwork",
                  )
                }
              >
                Run artwork_checklist_extractor
              </Button>
            ) : null}
            {tab === "samples" ? (
              <Button
                disabled={busy || !deal}
                onClick={() =>
                  void runSlot(
                    "sample_request_summarizer",
                    { email_text: emailText },
                    (r, id) =>
                      updateDeal(deal!.id, {
                        samples: samplesFromWorker(r, id),
                      }),
                    "samples",
                  )
                }
              >
                Run sample_request_summarizer
              </Button>
            ) : null}
            {tab === "pi_po" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !deal || (!deal?.pi && !deal?.po)}
                  onClick={() => {
                    if (!deal?.pi || !deal?.po) {
                      toast.error("Deal needs extracted PI and PO first");
                      return;
                    }
                    void runSlot(
                      "pi_po_discrepancy",
                      {
                        pi_json: JSON.stringify(deal.pi),
                        po_json: JSON.stringify(deal.po),
                      },
                      (r, id) =>
                        updateDeal(deal.id, {
                          discrepancy: discrepancyFromWorker(r, id),
                        }),
                      "pi_po",
                    );
                  }}
                >
                  Run pi_po_discrepancy
                </Button>
                <p className="w-full text-[11px] text-zinc-500">
                  Uses this deal&apos;s extracted PI/PO from mailbox processing
                  or Vault uploads.
                </p>
              </div>
            ) : null}
            {tab === "packaging" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !deal}
                  onClick={() =>
                    void runSlot(
                      "upc_barcode_matcher",
                      {
                        email_text: emailText,
                        notes: "UPC master + barcode art from deal sources",
                      },
                      (r, id) =>
                        updateDeal(deal!.id, {
                          upcMatch: upcFromWorker(r, id),
                        }),
                      "packaging",
                    )
                  }
                >
                  Run upc_barcode_matcher
                </Button>
              </div>
            ) : null}
            {tab === "production" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !deal}
                  onClick={() =>
                    void runSlot(
                      "production_status_extractor",
                      { email_text: emailText },
                      (r, id) =>
                        updateDeal(deal!.id, {
                          production: productionFromWorker(r, id),
                        }),
                      "production",
                    )
                  }
                >
                  Run production_status_extractor
                </Button>
              </div>
            ) : null}
            {tab === "booking" ? (
              <p className="text-xs text-zinc-500">
                booking_extractor / cbm_container_planner need a file URL from
                Vault or the deal&apos;s source attachments.
              </p>
            ) : null}
            {tab === "docs_payment" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !deal}
                  onClick={() =>
                    void runSlot(
                      "payment_clock",
                      {
                        email_text: emailText,
                        as_of_date: new Date().toISOString().slice(0, 10),
                      },
                      (r, id) =>
                        updateDeal(deal!.id, {
                          payment: paymentFromWorker(r, id),
                        }),
                      "docs_payment",
                    )
                  }
                >
                  Run payment_clock
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !deal || !emailText.trim()}
                  onClick={() => {
                    void runSlot(
                      "commission_checklist",
                      { email_text: emailText },
                      (r, id) =>
                        updateDeal(deal!.id, {
                          commission: commissionFromWorker(r, id),
                        }),
                      "docs_payment",
                    );
                  }}
                >
                  Run commission_checklist
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !deal}
                  onClick={() =>
                    void runSlot(
                      "final_docs_pack_check",
                      {
                        email_text: emailText,
                        notes: "PL V3F present; check full pack vs PO",
                      },
                      (r, id) =>
                        updateDeal(deal!.id, {
                          docsPack: docsPackFromWorker(r, id),
                        }),
                      "docs_payment",
                    )
                  }
                >
                  Run final_docs_pack_check
                </Button>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Stage results" />
          <div className="max-h-[32rem] space-y-3 overflow-auto p-4 text-sm">
            {!deal ? (
              <p className="text-zinc-500">Select or load a deal.</p>
            ) : (
              <StageResults deal={deal} tab={tab} />
            )}
          </div>
        </Card>
      </div>

      {deal ? (
        <div className="mt-4">
          <SourceEmailsPanel
            sources={deal.sources || []}
            title={`Source emails · ${deal.code}`}
            compact
          />
        </div>
      ) : null}
    </div>
  );
}

function StageResults({
  deal,
  tab,
}: {
  deal: NonNullable<ReturnType<typeof useTradeStore.getState>["deals"][0]>;
  tab: StageKey;
}) {
  if (tab === "artwork") {
    return deal.artwork ? (
      <>
        <Conf value={deal.artwork.confidence} />
        <p>{deal.artwork.summary}</p>
        <ul className="space-y-1">
          {deal.artwork.items.map((i, idx) => (
            <li key={idx}>
              <Badge>{i.status}</Badge> {i.asset}
            </li>
          ))}
        </ul>
      </>
    ) : (
      <Empty />
    );
  }
  if (tab === "samples") {
    return deal.samples ? (
      <>
        <Conf value={deal.samples.confidence} />
        <p>{deal.samples.summary}</p>
        <Field label="Courier" value={deal.samples.courier} />
        <Field label="AWB" value={deal.samples.trackingNumber} />
        <Field label="Status" value={deal.samples.status} />
      </>
    ) : (
      <Empty />
    );
  }
  if (tab === "pi_po") {
    return (
      <div className="space-y-3">
        {deal.pi ? (
          <div>
            <div className="font-medium">PI {deal.pi.docNumber}</div>
            <p className="text-xs text-zinc-500">{deal.pi.summary}</p>
            <p className="text-xs">
              {deal.pi.incoterm} · {deal.pi.pol}→{deal.pi.pod} ·{" "}
              {deal.pi.lines.length} lines
            </p>
          </div>
        ) : null}
        {deal.po ? (
          <div>
            <div className="font-medium">PO {deal.po.docNumber}</div>
            <p className="text-xs text-zinc-500">{deal.po.summary}</p>
          </div>
        ) : null}
        {deal.discrepancy ? (
          <div>
            <Badge tone={deal.discrepancy.aligned ? "success" : "warning"}>
              {deal.discrepancy.aligned ? "Aligned" : "Mismatches"}
            </Badge>
            <p className="mt-1">{deal.discrepancy.summary}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {deal.discrepancy.mismatches.map((m, i) => (
                <li key={i}>
                  {m.field}: {m.piValue} vs {m.poValue} ({m.severity})
                </li>
              ))}
            </ul>
          </div>
        ) : (
          !deal.pi && !deal.po && <Empty />
        )}
      </div>
    );
  }
  if (tab === "packaging") {
    return (
      <div className="space-y-3">
        {deal.upcMatch ? (
          <div>
            <p>{deal.upcMatch.summary}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {deal.upcMatch.rows.map((r, i) => (
                <li key={i}>
                  <Badge>{r.matchStatus}</Badge> {r.itemCode} {r.upc}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {deal.packaging ? (
          <div>
            <p>{deal.packaging.summary}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {deal.packaging.items.map((i, idx) => (
                <li key={idx}>
                  {i.present ? "✓" : "✗"} {i.view}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!deal.upcMatch && !deal.packaging ? <Empty /> : null}
      </div>
    );
  }
  if (tab === "production") {
    return (
      <div className="space-y-3">
        {deal.production ? (
          <>
            <p>{deal.production.summary}</p>
            <Field
              label="% complete"
              value={
                deal.production.percentComplete != null
                  ? String(deal.production.percentComplete)
                  : undefined
              }
            />
            <Field label="Ready" value={deal.production.readyDate} />
          </>
        ) : null}
        {deal.inspection ? (
          <>
            <p>{deal.inspection.summary}</p>
            <ul className="text-xs">
              {deal.inspection.findings.map((f, i) => (
                <li key={i}>
                  <Badge>{f.result}</Badge> {f.itemCode} {f.notes}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {!deal.production && !deal.inspection ? <Empty /> : null}
      </div>
    );
  }
  if (tab === "booking") {
    return (
      <div className="space-y-3">
        {deal.booking ? (
          <>
            <p>{deal.booking.summary}</p>
            <Field label="Booking #" value={deal.booking.bookingNumber} />
            <Field label="Vessel" value={deal.booking.vessel} />
            <Field
              label="Route"
              value={
                deal.booking.pol && deal.booking.pod
                  ? `${deal.booking.pol} → ${deal.booking.pod}`
                  : undefined
              }
            />
          </>
        ) : null}
        {deal.cbm ? (
          <>
            <p>{deal.cbm.summary}</p>
            <Field
              label="CBM"
              value={
                deal.cbm.totalCbm != null ? String(deal.cbm.totalCbm) : undefined
              }
            />
            <Field label="Equipment" value={deal.cbm.containerType} />
          </>
        ) : null}
        {!deal.booking && !deal.cbm ? <Empty /> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {deal.docsPack ? (
        <>
          <Badge tone={deal.docsPack.complete ? "success" : "warning"}>
            {deal.docsPack.complete ? "Complete" : "Incomplete"}
          </Badge>
          <p>{deal.docsPack.summary}</p>
          <Field label="Missing" value={deal.docsPack.missing.join(", ")} />
        </>
      ) : null}
      {deal.payment ? (
        <>
          <Badge>{deal.payment.status}</Badge>
          <p>{deal.payment.summary}</p>
          <Field label="Due" value={deal.payment.dueDate} />
        </>
      ) : null}
      {deal.commission ? (
        <>
          <p>{deal.commission.summary}</p>
          <ul className="text-xs">
            {deal.commission.items.map((i, idx) => (
              <li key={idx}>
                {i.done ? "✓" : "○"} {i.item}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!deal.docsPack && !deal.payment && !deal.commission ? <Empty /> : null}
    </div>
  );
}

function Conf({ value }: { value?: number }) {
  if (value == null) return null;
  return <Badge tone="info">{Math.round(value * 100)}% conf</Badge>;
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}

function Empty() {
  return (
    <p className="text-zinc-500">
      No results yet — run the agent or load stage data.
    </p>
  );
}
