"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { useWorkspaceProcess } from "@/components/layout/workspace-process";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";

const OPS_LANES = ["Buyer", "Agency (SNSPL)", "Factory", "Forwarder"] as const;
type OpsLane = (typeof OPS_LANES)[number];

interface OpsStep {
  id: string;
  phase: string;
  title: string;
  lane: OpsLane;
  detail: string;
}

const OPS_STEPS: OpsStep[] = [
  { id: "1", phase: "A · Requirement", title: "Buyer shares enquiry", lane: "Buyer", detail: "Category, retail, target FOB, contacts" },
  { id: "2", phase: "A · Requirement", title: "Approach factories", lane: "Agency (SNSPL)", detail: "Match partners by score & category" },
  { id: "3", phase: "A · Requirement", title: "AS / quote sheet", lane: "Factory", detail: "SKU matrix, MOQ, FOB" },
  { id: "4", phase: "A · Requirement", title: "Buyer selects SKUs", lane: "Buyer", detail: "Lock selection via agency" },
  { id: "5", phase: "B · Artwork", title: "Artwork / inserts", lane: "Buyer", detail: "Design files to agency" },
  { id: "6", phase: "B · Artwork", title: "Approval loop", lane: "Agency (SNSPL)", detail: "Forward ↔ factory ↔ buyer" },
  { id: "7", phase: "B · Samples", title: "Sample dispatch", lane: "Factory", detail: "Courier + photos" },
  { id: "8", phase: "C · Commercial", title: "Issue PI", lane: "Factory", detail: "Qty, packing, Incoterm" },
  { id: "9", phase: "C · Commercial", title: "Issue PO", lane: "Buyer", detail: "PO lines, UPC, load date" },
  { id: "10", phase: "C · Commercial", title: "PI vs PO check", lane: "Agency (SNSPL)", detail: "Discrepancy before lock" },
  { id: "11", phase: "D · Spec", title: "UPC / barcode / pack", lane: "Agency (SNSPL)", detail: "Approval gates 17–28" },
  { id: "12", phase: "E · Production", title: "Produce & inspect", lane: "Factory", detail: "Ready date, QC findings" },
  { id: "13", phase: "F · Booking", title: "Book & CBM plan", lane: "Forwarder", detail: "Cut-offs, vessel, equipment" },
  { id: "14", phase: "G · Close", title: "Docs & T/T clock", lane: "Agency (SNSPL)", detail: "CI/PL/BL · payment · commission" },
];

const OPS_PHASES: readonly string[] = [
  "Requirement → Quote",
  "Artwork & samples",
  "PI / PO lock",
  "Spec & packaging",
  "Production",
  "Booking",
  "Docs · pay · commission",
];

const FINANCE_LANES = [
  "Buyer",
  "Agency · Sourcing",
  "Agency · Accounts",
  "Factory",
] as const;
type FinanceLane = (typeof FINANCE_LANES)[number];

interface FinanceStep {
  id: string;
  phase: string;
  title: string;
  lane: FinanceLane;
  detail: string;
}

/** Finance process starts at PI/PO — Accounts is SNSPL Accounts (same agency). */
const FINANCE_STEPS: FinanceStep[] = [
  { id: "1", phase: "0 · PI / PO", title: "PI & PO received", lane: "Agency · Sourcing", detail: "Lock commercial docs; capture payment terms both sides" },
  { id: "2", phase: "0 · PI / PO", title: "Parse payment terms", lane: "Agency · Accounts", detail: "Buyer PO + factory PI installments & checkpoints" },
  { id: "3", phase: "1 · Deploy", title: "Advance / deposit out", lane: "Agency · Accounts", detail: "Pay factory installment when checkpoint met" },
  { id: "4", phase: "1 · Deploy", title: "Confirm factory receipt", lane: "Factory", detail: "Email / advice — installment received" },
  { id: "5", phase: "2 · Track", title: "Open installments", lane: "Agency · Accounts", detail: "Still required · rolling 30–120d need" },
  { id: "6", phase: "2 · Track", title: "Cash blocked by stage", lane: "Agency · Sourcing", detail: "Production / transit / docs hold cash" },
  { id: "7", phase: "3 · Recover", title: "Buyer checkpoint due", lane: "Buyer", detail: "PO term gate (PO ack, BL, sailing…)" },
  { id: "8", phase: "3 · Recover", title: "Buyer remittance confirmed", lane: "Agency · Accounts", detail: "Email confirms payment against checkpoint" },
  { id: "9", phase: "3 · Recover", title: "Vendor ↔ buyer gap", lane: "Agency · Accounts", detail: "Days between factory pay and buyer collect" },
  { id: "10", phase: "4 · Settle", title: "Factory confirms buyer funds", lane: "Factory", detail: "Commercial settled on factory books" },
  { id: "11", phase: "4 · Settle", title: "Commission invoice / FX", lane: "Agency · Accounts", detail: "Agency fee awaiting, chasing, or received" },
  { id: "12", phase: "4 · Settle", title: "Close deal ledger", lane: "Agency · Sourcing", detail: "Sourcing + Accounts close the order" },
];

const FINANCE_PHASES: readonly string[] = [
  "PI / PO + terms",
  "Deploy to factory",
  "Track exposure",
  "Buyer recoveries",
  "Commission settle",
];

/** "1 · Deploy" → "Deploy" (the band reads left-to-right, so the prefix is noise). */
function phaseName(phase: string) {
  const parts = phase.split("·");
  return (parts.length > 1 ? parts.slice(1).join("·") : phase).trim();
}

function PhaseStepper({ phases }: { phases: readonly string[] }) {
  return (
    <ol className="phase-stepper" aria-label="Phases">
      {phases.map((name, i) => (
        <li key={name} className="phase-step">
          <span className="phase-step-index">{i + 1}</span>
          <span className="phase-step-name">{name}</span>
          {i < phases.length - 1 ? (
            <ChevronRight className="phase-step-arrow" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

type SwimlaneStep = { id: string; phase: string; title: string; lane: string; detail: string };

function Swimlane({
  lanes,
  steps,
}: {
  lanes: readonly string[];
  steps: readonly SwimlaneStep[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const syncEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  }, []);

  useEffect(() => {
    syncEdges();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncEdges]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.7, 200), behavior: "smooth" });
  };

  // Consecutive steps that share a phase render as one spanning band cell.
  const bands = steps.reduce<{ name: string; span: number }[]>((acc, step) => {
    const last = acc[acc.length - 1];
    if (last && last.name === step.phase) last.span += 1;
    else acc.push({ name: step.phase, span: 1 });
    return acc;
  }, []);

  const columns = { gridTemplateColumns: `repeat(${steps.length}, var(--swimlane-col))` };

  return (
    <div className="swimlane">
      <div className="swimlane-toolbar">
        <span>
          {steps.length} steps · {lanes.length} lanes
        </span>
        <div className="swimlane-nav">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            disabled={!edges.left}
            aria-label="Scroll steps left"
          >
            <ChevronLeft aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            disabled={!edges.right}
            aria-label="Scroll steps right"
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
      <div
        className={`swimlane-frame${edges.left ? " has-left" : ""}${edges.right ? " has-right" : ""}`}
      >
        <div className="swimlane-labels">
          <div className="swimlane-head-spacer" aria-hidden />
          {lanes.map((lane) => (
            <div key={lane} className="swimlane-label">
              {lane}
            </div>
          ))}
        </div>
        <div
          ref={scrollRef}
          className="swimlane-scroll"
          onScroll={syncEdges}
          tabIndex={0}
          aria-label="Process steps by lane"
        >
          <div className="swimlane-grid" style={columns}>
            {bands.map((band, i) => (
              <div
                key={`band-${i}`}
                className="swimlane-band"
                style={{ gridColumn: `span ${band.span}` }}
                title={band.name}
              >
                {phaseName(band.name)}
              </div>
            ))}
            {steps.map((step) => (
              <div key={`h-${step.id}`} className="swimlane-step-no">
                <span>{step.id}</span>
              </div>
            ))}
            {lanes.map((lane) => (
              <Fragment key={lane}>
                {steps.map((step) =>
                  step.lane === lane ? (
                    <div key={`${lane}-${step.id}`} className="swimlane-card">
                      <div className="swimlane-card-title">{step.title}</div>
                      <div className="swimlane-card-detail" title={step.detail}>
                        {step.detail}
                      </div>
                    </div>
                  ) : (
                    <div key={`${lane}-${step.id}`} className="swimlane-empty" aria-hidden />
                  ),
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OpsProcessMap() {
  return (
    <div>
      <PageHeader
        title="Sourcing process map"
        description="How SNSPL moves a deal from enquiry through production, sailing, payment, and commission close."
      />

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="End-to-end flow"
          description="Requirement → Development → Sample → PO → Production → Inspection → Packing → Booking → Docs → Payment → Commission"
        />
        <div className="px-4 py-4">
          <PhaseStepper phases={OPS_PHASES} />
        </div>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Swimlanes" description="Who owns each handoff" />
        <Swimlane lanes={OPS_LANES} steps={OPS_STEPS} />
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(
          OPS_STEPS.reduce<Record<string, OpsStep[]>>((acc, s) => {
            (acc[s.phase] ||= []).push(s);
            return acc;
          }, {}),
        ).map(([phase, steps]) => (
          <Card key={phase}>
            <CardHeader title={phase} />
            <ol className="space-y-2 px-4 py-3">
              {steps.map((s) => (
                <li key={s.id} className="flex gap-2 text-sm">
                  <Badge tone="info">{s.id}</Badge>
                  <div>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-zinc-500">
                      {s.lane} · {s.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-4">
        <h2 className="text-sm font-semibold">Commercial pattern</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Typical lane: FOB India → USA. Payment often{" "}
          <strong>T/T against B/L</strong> (~30 days after BL shared), then
          release, then agency commission after the factory confirms buyer
          funds.
        </p>
      </Card>
    </div>
  );
}

function FinanceProcessMap() {
  return (
    <div>
      <PageHeader
        title="Finance process map"
        description="Starts when PI/PO are in hand. Accounts is SNSPL Accounts — same agency as Sourcing, split only by function."
      />

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Cash cycle"
          description="PI/PO + payment terms → Deploy to factory → Track → Buyer recoveries (checkpoints + email confirm) → Commission settle"
        />
        <div className="px-4 py-4">
          <PhaseStepper phases={FINANCE_PHASES} />
        </div>
        <p className="border-t border-[var(--line)] px-5 py-4 text-sm leading-relaxed text-[var(--muted)]">
          <strong className="text-[var(--ink)]">Agency · Sourcing</strong> and{" "}
          <strong className="text-[var(--ink)]">Agency · Accounts</strong> are both
          Savvy Net Sourcing (SNSPL) — not separate legal entities.
        </p>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Cash lanes"
          description="Buyer · SNSPL (Sourcing / Accounts) · Factory"
        />
        <Swimlane lanes={FINANCE_LANES} steps={FINANCE_STEPS} />
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(
          FINANCE_STEPS.reduce<Record<string, FinanceStep[]>>((acc, s) => {
            (acc[s.phase] ||= []).push(s);
            return acc;
          }, {}),
        ).map(([phase, steps]) => (
          <Card key={phase}>
            <CardHeader title={phase} />
            <ol className="space-y-2 px-4 py-3">
              {steps.map((s) => (
                <li key={s.id} className="flex gap-2 text-sm">
                  <Badge tone="info">{s.id}</Badge>
                  <div>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-zinc-500">
                      {s.lane} · {s.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function ProcessMapPage() {
  const { processId } = useWorkspaceProcess();
  return processId === "finance" ? <FinanceProcessMap /> : <OpsProcessMap />;
}
