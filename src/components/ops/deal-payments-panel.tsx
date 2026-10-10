"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { SourceEmailsPanel } from "@/components/ops/source-emails-panel";
import type { Deal, PaymentCheckpoint } from "@/types/trade";
import { usd } from "@/lib/trade/commandCenterMetrics";
import {
  computeDaysLate,
  ensurePaymentSchedule,
  lateLabel,
} from "@/lib/trade/paymentSchedule";

function sideTotals(
  checkpoints: NonNullable<ReturnType<typeof ensurePaymentSchedule>>["checkpoints"],
  side: "buyer" | "factory",
) {
  const list = checkpoints.filter((c) => c.side === side);
  const agreed = list.reduce((a, c) => a + c.amountUsd, 0);
  const received = list
    .filter((c) => c.status === "received")
    .reduce((a, c) => a + c.amountUsd, 0);
  const outstanding = list
    .filter((c) => c.status !== "received" && c.status !== "waived")
    .reduce((a, c) => a + c.amountUsd, 0);
  return { agreed, received, outstanding, list };
}

type SideSort = "default" | "buyer-first" | "factory-first";

function sortCheckpoints(
  checkpoints: PaymentCheckpoint[],
  sort: SideSort,
): PaymentCheckpoint[] {
  const copy = [...checkpoints];
  if (sort === "buyer-first") {
    return copy.sort((a, b) => {
      if (a.side === b.side) return (a.dueDate || "").localeCompare(b.dueDate || "");
      return a.side === "buyer" ? -1 : 1;
    });
  }
  if (sort === "factory-first") {
    return copy.sort((a, b) => {
      if (a.side === b.side) return (a.dueDate || "").localeCompare(b.dueDate || "");
      return a.side === "factory" ? -1 : 1;
    });
  }
  return copy;
}

export function DealPaymentsPanel({ deal }: { deal: Deal }) {
  const [sideSort, setSideSort] = useState<SideSort>("default");
  const schedule = ensurePaymentSchedule(deal);
  const paymentSources = (deal.sources || []).filter((s) =>
    ["payment", "po", "pi", "commission"].includes(s.kind),
  );

  const sortedCheckpoints = useMemo(
    () =>
      schedule?.checkpoints
        ? sortCheckpoints(schedule.checkpoints, sideSort)
        : [],
    [schedule?.checkpoints, sideSort],
  );

  if (!schedule?.checkpoints?.length) {
    return (
      <div id="payments">
        <Card>
          <CardHeader
            title="Payments"
            description="PO/PI payment terms and remittance actuals"
          />
          <p className="px-4 py-3 text-sm text-zinc-500">
            No structured payment schedule on this deal yet. Once PI/PO terms are
            extracted, installments and confirmation emails appear here.
          </p>
        </Card>
      </div>
    );
  }

  const buyer = sideTotals(schedule.checkpoints, "buyer");
  const factory = sideTotals(schedule.checkpoints, "factory");
  const sortHint =
    sideSort === "buyer-first"
      ? "Buyer first"
      : sideSort === "factory-first"
        ? "Factory first"
        : "Default";

  return (
    <div id="payments" className="space-y-4">
      <Card>
        <CardHeader
          title="Payments"
          description="Agreed terms vs remittances confirmed from email"
        />
        <div className="grid gap-3 border-b border-zinc-100 px-4 py-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Buyer terms (PO)
            </div>
            <p className="mt-1 text-sm text-zinc-800">
              {schedule.buyerTerms || deal.po?.paymentTerms || "—"}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] uppercase text-zinc-500">Agreed</div>
                <div className="font-mono text-sm font-semibold">
                  {usd(buyer.agreed)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-zinc-500">
                  Received
                </div>
                <div className="font-mono text-sm font-semibold text-emerald-700">
                  {usd(buyer.received)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-zinc-500">Open</div>
                <div className="font-mono text-sm font-semibold text-amber-700">
                  {usd(buyer.outstanding)}
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Factory terms (PI)
            </div>
            <p className="mt-1 text-sm text-zinc-800">
              {schedule.factoryTerms || deal.pi?.paymentTerms || "—"}
            </p>
            {factory.list.length === 0 ? (
              <p className="mt-3 text-xs text-amber-800">
                No factory PI extract on this deal yet — buyer PO value is not
                mirrored as factory payable.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Agreed</div>
                  <div className="font-mono text-sm font-semibold">
                    {usd(factory.agreed)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Paid</div>
                  <div className="font-mono text-sm font-semibold text-emerald-700">
                    {usd(factory.received)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Still due</div>
                  <div className="font-mono text-sm font-semibold text-amber-700">
                    {usd(factory.outstanding)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-500">
          Source:{" "}
          {deal.po?.docNumber || deal.mailboxSlot === "po_extractor"
            ? "buyer PO extract"
            : deal.pi?.docNumber
              ? "factory PI extract"
              : deal.mailboxSlot || "mailbox extract"}
          {deal.po?.totalAmount
            ? ` · PO ${usd(deal.po.totalAmount)}`
            : ""}
          {deal.pi?.totalAmount
            ? ` · PI ${usd(deal.pi.totalAmount)}`
            : ""}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-zinc-800"
                    onClick={() =>
                      setSideSort((s) =>
                        s === "default"
                          ? "buyer-first"
                          : s === "buyer-first"
                            ? "factory-first"
                            : "default",
                      )
                    }
                    title="Sort buyer / factory rows"
                  >
                    Side
                    <ChevronsUpDown className="h-3 w-3" />
                  </button>
                  <span className="mt-0.5 block text-[9px] font-normal normal-case tracking-normal text-zinc-400">
                    {sortHint}
                  </span>
                </th>
                <th className="px-4 py-2 font-medium">Installment</th>
                <th className="px-4 py-2 font-medium">Checkpoint</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Actual</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedCheckpoints.map((cp) => {
                const daysLate = computeDaysLate(cp);
                const notReceived =
                  cp.status === "overdue" ||
                  (daysLate != null &&
                    daysLate > 0 &&
                    cp.status !== "received");
                const late = lateLabel(daysLate, notReceived);
                const confirm = (deal.sources || []).find(
                  (s) => s.id === cp.confirmationSourceId,
                );
                const linked = (deal.sources || []).filter((s) =>
                  (cp.sourceIds || []).includes(s.id),
                );
                return (
                  <tr
                    key={cp.id}
                    className="border-b border-zinc-50 align-top"
                  >
                    <td className="px-4 py-2.5">
                      <Badge tone={cp.side === "buyer" ? "info" : "neutral"}>
                        {cp.side === "buyer" ? "Buyer" : "Factory"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-zinc-900">{cp.label}</div>
                      {cp.termsExcerpt ? (
                        <div className="text-[11px] text-zinc-500">
                          {cp.termsExcerpt}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-600">
                      {cp.checkpoint || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">
                      {usd(cp.amountUsd)}
                      {cp.percent != null ? (
                        <div className="font-sans font-normal text-zinc-500">
                          {cp.percent}%
                        </div>
                      ) : null}
                      {linked.length > 0 ? (
                        <div className="mt-1 space-y-0.5 text-left font-sans font-normal">
                          {linked.slice(0, 2).map((s) => (
                            <a
                              key={s.id}
                              href={`#source-${s.id}`}
                              className="block text-[10px] text-teal-700 hover:underline"
                            >
                              ← {(s.subject || s.label || "Source mail").slice(0, 42)}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-600">
                      {cp.dueDate || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {cp.status === "received" ? (
                        <div>
                          <span className="font-medium text-emerald-700">
                            Received
                          </span>
                          {cp.receivedAt ? (
                            <div className="font-mono text-zinc-500">
                              {cp.receivedAt}
                            </div>
                          ) : null}
                          {late ? (
                            <div className="mt-0.5 text-[11px] font-semibold text-red-600">
                              {late}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div>
                          <span className="font-medium text-amber-800">
                            Not received
                          </span>
                          {late ? (
                            <div className="mt-0.5 text-[11px] font-semibold text-red-600">
                              {late}
                            </div>
                          ) : cp.dueDate ? (
                            <div className="text-zinc-500">
                              Awaiting checkpoint
                            </div>
                          ) : null}
                        </div>
                      )}
                      {confirm ? (
                        <div className="mt-1 text-[10px] text-teal-800">
                          Email: {confirm.subject || confirm.label || confirm.id}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          cp.status === "received"
                            ? "success"
                            : cp.status === "overdue"
                              ? "danger"
                              : cp.status === "due"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {cp.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <SourceEmailsPanel
        sources={paymentSources}
        title="Payment source messages"
        kinds={["payment", "po", "pi", "commission"]}
        compact
      />
    </div>
  );
}
