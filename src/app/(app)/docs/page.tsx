"use client";

import { Fragment } from "react";
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

const OPS_PHASES = [
  { name: "Requirement → Quote", color: "bg-teal-700" },
  { name: "Artwork & samples", color: "bg-emerald-700" },
  { name: "PI / PO lock", color: "bg-cyan-800" },
  { name: "Spec & packaging", color: "bg-sky-800" },
  { name: "Production", color: "bg-indigo-800" },
  { name: "Booking", color: "bg-violet-800" },
  { name: "Docs · pay · commission", color: "bg-zinc-800" },
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

const FINANCE_PHASES = [
  { name: "PI / PO + terms", color: "bg-zinc-800" },
  { name: "Deploy to factory", color: "bg-teal-700" },
  { name: "Track exposure", color: "bg-amber-700" },
  { name: "Buyer recoveries", color: "bg-sky-800" },
  { name: "Commission settle", color: "bg-emerald-800" },
];

function Swimlane({
  lanes,
  steps,
}: {
  lanes: readonly string[];
  steps: readonly { id: string; title: string; lane: string; detail: string }[];
}) {
  return (
    <div className="overflow-x-auto px-5 pb-5 pt-2">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `11rem repeat(${steps.length}, minmax(9.25rem, 1fr))`,
          minWidth: `${11 + steps.length * 9.25}rem`,
        }}
      >
        <div />
        {steps.map((step) => (
          <div
            key={`h-${step.id}`}
            className="pb-1 text-center text-xs font-semibold text-[var(--muted)]"
          >
            {step.id}
          </div>
        ))}
        {lanes.map((lane) => (
          <Fragment key={lane}>
            <div className="sticky left-0 z-[1] flex items-center rounded-xl bg-[var(--muted-bg)] px-3 py-3 text-[13px] font-semibold leading-snug text-[var(--ink)]">
              {lane}
            </div>
            {steps.map((step) =>
              step.lane === lane ? (
                <div
                  key={`${lane}-${step.id}`}
                  className="flex min-h-[7.5rem] flex-col gap-1.5 rounded-xl border border-[color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[var(--accent-soft)] p-3"
                >
                  <div className="text-[13px] font-semibold leading-snug text-[var(--ink)]">
                    {step.title}
                  </div>
                  <div className="text-xs leading-relaxed text-[var(--muted)]">
                    {step.detail}
                  </div>
                </div>
              ) : (
                <div
                  key={`${lane}-${step.id}`}
                  className="min-h-[7.5rem] rounded-xl bg-[color-mix(in_srgb,var(--muted-bg)_55%,transparent)]"
                  aria-hidden
                />
              ),
            )}
          </Fragment>
        ))}
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
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {OPS_PHASES.map((p) => (
            <span
              key={p.name}
              className={`${p.color} rounded-full px-3 py-1.5 text-xs font-semibold text-white`}
            >
              {p.name}
            </span>
          ))}
        </div>
      </Card>

      <Card className="mb-6">
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
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {FINANCE_PHASES.map((p) => (
            <span
              key={p.name}
              className={`${p.color} rounded-full px-3 py-1.5 text-xs font-semibold text-white`}
            >
              {p.name}
            </span>
          ))}
        </div>
        <p className="border-t border-zinc-100 px-5 py-4 text-sm leading-relaxed text-zinc-500">
          <strong className="text-zinc-700">Agency · Sourcing</strong> and{" "}
          <strong className="text-zinc-700">Agency · Accounts</strong> are both
          Savvy Net Sourcing (SNSPL) — not separate legal entities.
        </p>
      </Card>

      <Card className="mb-6">
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
