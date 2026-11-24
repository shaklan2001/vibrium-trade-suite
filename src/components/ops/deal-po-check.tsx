"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { checkPo, type PoIssue } from "@/lib/trade/poCheck";
import type { Deal } from "@/types/trade";

const TONE: Record<PoIssue["severity"], string> = {
  high: "text-red-700",
  medium: "text-amber-700",
  low: "text-zinc-500",
};

function Issues({ issues }: { issues: PoIssue[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {issues.map((i, n) => (
        <li key={`${i.field}-${n}`} className={`flex items-start gap-1.5 text-xs ${TONE[i.severity]}`}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** The buyer's first PO is the baseline; the factory documents and later POs are checked against it. */
export function DealPoCheck({ deal }: { deal: Deal }) {
  const check = useMemo(() => checkPo(deal), [deal]);
  if (!check.baseline) return null;
  const clean = check.all.length === 0;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
      <h3 className="flex items-center gap-2 font-semibold">
        {clean ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className={`h-4 w-4 ${check.hasHigh ? "text-red-600" : "text-amber-600"}`} />}
        PO check
        <span className="text-xs font-normal text-zinc-500">
          Baseline: first buyer PO {check.baseline.label}
          {check.baseline.sentAt ? ` (${check.baseline.sentAt.slice(0, 10)})` : ""}
        </span>
      </h3>
      {check.sanity.length ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-zinc-600">Buyer PO</p>
          <Issues issues={check.sanity} />
        </div>
      ) : null}
      {check.comparisons.map((c) => (
        <div key={`${c.kind}-${c.doc.label}-${c.doc.sentAt}`} className="mt-2">
          <p className="text-xs font-medium text-zinc-600">
            {c.kind === "factory" ? "Passed to factory" : "Revised buyer PO"}: {c.doc.label}
            {c.issues.length ? "" : " — matches the buyer PO"}
          </p>
          {c.issues.length ? <Issues issues={c.issues} /> : null}
        </div>
      ))}
      {clean && !check.comparisons.length ? <p className="mt-1 text-xs text-zinc-500">Buyer PO looks consistent. No factory document to compare yet.</p> : null}
    </section>
  );
}
