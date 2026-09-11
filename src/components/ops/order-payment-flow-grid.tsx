"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildOrderPaymentFlow,
  columnLaneTotals,
  flowAmountLabel,
  sortFlowRows,
  sumLaneCells,
  sumMonthMap,
  type FlowCell,
  type FlowLaneKey,
  type FlowSideSort,
} from "@/lib/trade/paymentFlowGrid";
import {
  lateLabel,
  type OrderPaymentBucket,
  type PaymentLine,
} from "@/lib/trade/paymentSchedule";

function CellBlock({
  cell,
  tone,
  onClick,
  highlight,
}: {
  cell: FlowCell;
  tone: "rcv" | "pay" | "rcv-plan" | "pay-plan";
  onClick: () => void;
  highlight?: boolean;
}) {
  if (!cell.amountUsd) {
    return (
      <div
        className={cn(
          "h-9 min-w-[4.5rem]",
          highlight && "rounded-sm bg-teal-50/60",
        )}
      />
    );
  }
  const isPlan = tone === "rcv-plan" || tone === "pay-plan";
  const lateText = isPlan ? null : lateLabel(cell.lateDays, cell.notReceived);
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        lateText
          ? `${flowAmountLabel(cell.amountUsd)} · ${lateText}`
          : `${isPlan ? "Terms · " : ""}${flowAmountLabel(cell.amountUsd)}`
      }
      className={cn(
        "relative flex h-9 min-w-[4.5rem] flex-col items-center justify-center rounded-sm border px-1.5 text-[11px] font-semibold tabular-nums leading-tight",
        tone === "rcv" && "border-slate-300 bg-slate-200/80 text-slate-800",
        tone === "pay" && "border-zinc-200 bg-zinc-100 text-zinc-700",
        tone === "rcv-plan" &&
          "border-dashed border-sky-300 bg-sky-50/70 text-sky-900",
        tone === "pay-plan" &&
          "border-dashed border-amber-300 bg-amber-50/60 text-amber-900",
        highlight && "ring-2 ring-teal-600/40",
        !isPlan && cell.late && "border-red-400 ring-1 ring-red-300",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-0.5 rounded-l-sm",
          isPlan ? "bg-sky-400/80" : "bg-zinc-500/70",
        )}
      />
      <span>{flowAmountLabel(cell.amountUsd)}</span>
      {lateText ? (
        <span className="text-[8px] font-bold uppercase tracking-wide text-red-600">
          {cell.lateDays != null && cell.lateDays > 0
            ? `+${cell.lateDays}D`
            : "Due"}
          {cell.notReceived ? " · open" : ""}
        </span>
      ) : isPlan ? (
        <span className="text-[8px] font-semibold uppercase tracking-wide text-zinc-500">
          Terms
        </span>
      ) : null}
    </button>
  );
}

function TotalCell({
  amount,
  tone,
  title,
}: {
  amount: number;
  tone: "rcv" | "pay" | "rcv-plan" | "pay-plan" | "footer";
  title?: string;
}) {
  if (!amount) {
    return (
      <div className="flex h-9 min-w-[4.5rem] items-center justify-center text-[11px] tabular-nums text-zinc-300">
        —
      </div>
    );
  }
  return (
    <div
      title={title || flowAmountLabel(amount)}
      className={cn(
        "flex h-9 min-w-[4.5rem] items-center justify-center rounded-sm border px-1.5 text-[11px] font-bold tabular-nums",
        tone === "rcv" && "border-slate-400 bg-slate-100 text-slate-900",
        tone === "pay" && "border-zinc-300 bg-zinc-50 text-zinc-900",
        tone === "rcv-plan" &&
          "border-dashed border-sky-400 bg-sky-50 text-sky-950",
        tone === "pay-plan" &&
          "border-dashed border-amber-400 bg-amber-50 text-amber-950",
        tone === "footer" && "border-zinc-400 bg-zinc-100 text-zinc-900",
      )}
    >
      {flowAmountLabel(amount)}
    </div>
  );
}

function LaneCells({
  months,
  cells,
  tone,
  dealCode,
  laneLabel,
  order,
  rowTotal,
  onSelectOrder,
  onSelectLines,
}: {
  months: ReturnType<typeof buildOrderPaymentFlow>["months"];
  cells: Record<string, FlowCell>;
  tone: "rcv" | "pay" | "rcv-plan" | "pay-plan";
  dealCode: string;
  laneLabel: string;
  order: OrderPaymentBucket;
  rowTotal: number;
  onSelectOrder: (order: OrderPaymentBucket) => void;
  onSelectLines: (
    title: string,
    lines: PaymentLine[],
    subtitle?: string,
  ) => void;
}) {
  return (
    <>
      {months.map((m) => (
        <td
          key={`${tone}-${dealCode}-${m.key}`}
          className={cn("px-0.5 py-1", m.isCurrent && "bg-teal-50/50")}
        >
          <CellBlock
            cell={cells[m.key]!}
            tone={tone}
            highlight={m.isCurrent}
            onClick={() => {
              const cell = cells[m.key]!;
              if (!cell.lines.length) {
                onSelectOrder(order);
                return;
              }
              onSelectLines(
                `${dealCode} · ${m.label} · ${laneLabel}`,
                cell.lines,
                tone.includes("plan")
                  ? "PO/PI agreed schedule (due month)"
                  : undefined,
              );
            }}
          />
        </td>
      ))}
      <td className="border-l border-zinc-200 bg-zinc-50/80 px-0.5 py-1">
        <TotalCell
          amount={rowTotal}
          tone={tone}
          title={`${dealCode} · ${laneLabel} total`}
        />
      </td>
    </>
  );
}

function FooterLaneRow({
  label,
  laneKey,
  tone,
  months,
  colTotals,
  showOrderCell,
  rowSpan,
}: {
  label: string;
  laneKey: FlowLaneKey;
  tone: "rcv" | "pay" | "rcv-plan" | "pay-plan";
  months: ReturnType<typeof buildOrderPaymentFlow>["months"];
  colTotals: ReturnType<typeof columnLaneTotals>;
  showOrderCell: boolean;
  rowSpan: number;
}) {
  const byMonth = colTotals[laneKey];
  const grand = sumMonthMap(byMonth, months);
  return (
    <tr className="border-t border-zinc-300 bg-zinc-50/90 align-middle">
      {showOrderCell ? (
        <td
          rowSpan={rowSpan}
          className="sticky left-0 z-10 border-r border-zinc-200 bg-zinc-100 px-2 py-1 align-middle text-[10px] font-bold uppercase tracking-wide text-zinc-700"
        >
          Total
        </td>
      ) : null}
      <td
        className={cn(
          "px-1 py-1 text-[10px] font-bold uppercase",
          tone === "rcv-plan" && "text-sky-800",
          tone === "rcv" && "text-slate-700",
          tone === "pay-plan" && "text-amber-900",
          tone === "pay" && "text-zinc-700",
        )}
      >
        {label}
      </td>
      {months.map((m) => (
        <td
          key={`tot-${laneKey}-${m.key}`}
          className={cn("px-0.5 py-1", m.isCurrent && "bg-teal-50/70")}
        >
          <TotalCell
            amount={byMonth[m.key] || 0}
            tone="footer"
            title={`${m.label} · ${label}`}
          />
        </td>
      ))}
      <td className="border-l border-zinc-300 bg-zinc-100 px-0.5 py-1">
        <TotalCell
          amount={grand}
          tone="footer"
          title={`All months · ${label}`}
        />
      </td>
    </tr>
  );
}

const SORT_CYCLE: FlowSideSort[] = ["default", "buyer", "factory"];

export function OrderPaymentFlowGrid({
  orders,
  onSelectOrder,
  onSelectLines,
}: {
  orders: OrderPaymentBucket[];
  onSelectOrder: (order: OrderPaymentBucket) => void;
  onSelectLines: (
    title: string,
    lines: PaymentLine[],
    subtitle?: string,
  ) => void;
}) {
  const [showTerms, setShowTerms] = useState(true);
  const [sideSort, setSideSort] = useState<FlowSideSort>("default");
  const flow = useMemo(() => buildOrderPaymentFlow(orders), [orders]);
  const rows = useMemo(
    () => sortFlowRows(flow.rows, sideSort),
    [flow.rows, sideSort],
  );
  const colTotals = useMemo(
    () => columnLaneTotals(rows, flow.months),
    [rows, flow.months],
  );

  if (!orders.length) {
    return (
      <p className="px-3 py-6 text-sm text-zinc-500">
        No payment-term schedules on the open book yet.
      </p>
    );
  }

  const rowSpan = showTerms ? 4 : 2;
  const sortLabel =
    sideSort === "buyer"
      ? "Buyer RCV ↓"
      : sideSort === "factory"
        ? "Factory PAY ↓"
        : "Default";

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Order-wise payment flow
          </div>
          <p className="text-[11px] text-zinc-500">
            RCV = buyer · PAY = factory
            {showTerms ? " · dashed = PO/PI terms by due month" : ""} · row &
            column totals · current month highlighted
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700">
          <input
            type="checkbox"
            className="rounded border-zinc-300"
            checked={showTerms}
            onChange={(e) => setShowTerms(e.target.checked)}
          />
          Show PO/PI terms rows
        </label>
      </div>
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="sticky left-0 z-10 bg-white px-2 py-2 font-medium">
              Order
            </th>
            <th className="px-1 py-2 font-medium">
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-zinc-800"
                onClick={() => {
                  const i = SORT_CYCLE.indexOf(sideSort);
                  setSideSort(SORT_CYCLE[(i + 1) % SORT_CYCLE.length]!);
                }}
                title="Sort by buyer or factory totals"
              >
                Lane
                {sideSort === "default" ? (
                  <ChevronsUpDown className="h-3 w-3" />
                ) : sideSort === "buyer" ? (
                  <ArrowDownAZ className="h-3 w-3" />
                ) : (
                  <ArrowUpDown className="h-3 w-3" />
                )}
              </button>
              <span className="mt-0.5 block text-[9px] font-normal normal-case tracking-normal text-zinc-400">
                {sortLabel}
              </span>
            </th>
            {flow.months.map((m) => (
              <th
                key={m.key}
                className={cn(
                  "px-1 py-2 text-center font-medium tabular-nums",
                  m.isCurrent &&
                    "rounded-t-md bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-200",
                )}
              >
                {m.label}
                {m.isCurrent ? (
                  <span className="mt-0.5 block text-[9px] font-semibold normal-case tracking-normal text-teal-700">
                    Current
                  </span>
                ) : null}
              </th>
            ))}
            <th className="border-l border-zinc-200 bg-zinc-50 px-1 py-2 text-center font-semibold text-zinc-700">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ order, rcv, pay, rcvPlan, payPlan }) => (
            <Fragment key={order.dealId}>
              {showTerms ? (
                <tr className="border-b border-zinc-50 align-middle">
                  <td
                    rowSpan={rowSpan}
                    className="sticky left-0 z-10 border-r border-zinc-100 bg-white px-2 py-1 align-middle"
                  >
                    <button
                      type="button"
                      className="font-mono text-xs font-semibold text-teal-800 hover:underline"
                      onClick={() => onSelectOrder(order)}
                    >
                      {order.dealCode}
                    </button>
                  </td>
                  <td className="px-1 py-1 text-[10px] font-semibold uppercase text-sky-700">
                    Rcv · terms
                  </td>
                  <LaneCells
                    months={flow.months}
                    cells={rcvPlan}
                    tone="rcv-plan"
                    dealCode={order.dealCode}
                    laneLabel="RCV terms"
                    order={order}
                    rowTotal={sumLaneCells(rcvPlan, flow.months)}
                    onSelectOrder={onSelectOrder}
                    onSelectLines={onSelectLines}
                  />
                </tr>
              ) : null}

              <tr className="border-b border-zinc-50 align-middle">
                {!showTerms ? (
                  <td
                    rowSpan={rowSpan}
                    className="sticky left-0 z-10 border-r border-zinc-100 bg-white px-2 py-1 align-middle"
                  >
                    <button
                      type="button"
                      className="font-mono text-xs font-semibold text-teal-800 hover:underline"
                      onClick={() => onSelectOrder(order)}
                    >
                      {order.dealCode}
                    </button>
                  </td>
                ) : null}
                <td className="px-1 py-1 text-[10px] font-semibold uppercase text-slate-500">
                  Rcv
                </td>
                <LaneCells
                  months={flow.months}
                  cells={rcv}
                  tone="rcv"
                  dealCode={order.dealCode}
                  laneLabel="RCV"
                  order={order}
                  rowTotal={sumLaneCells(rcv, flow.months)}
                  onSelectOrder={onSelectOrder}
                  onSelectLines={onSelectLines}
                />
              </tr>

              {showTerms ? (
                <tr className="border-b border-zinc-50 align-middle">
                  <td className="px-1 py-1 text-[10px] font-semibold uppercase text-amber-800">
                    Pay · terms
                  </td>
                  <LaneCells
                    months={flow.months}
                    cells={payPlan}
                    tone="pay-plan"
                    dealCode={order.dealCode}
                    laneLabel="PAY terms"
                    order={order}
                    rowTotal={sumLaneCells(payPlan, flow.months)}
                    onSelectOrder={onSelectOrder}
                    onSelectLines={onSelectLines}
                  />
                </tr>
              ) : null}

              <tr className="border-b border-zinc-200 align-middle">
                <td className="px-1 py-1 text-[10px] font-semibold uppercase text-zinc-500">
                  Pay
                </td>
                <LaneCells
                  months={flow.months}
                  cells={pay}
                  tone="pay"
                  dealCode={order.dealCode}
                  laneLabel="PAY"
                  order={order}
                  rowTotal={sumLaneCells(pay, flow.months)}
                  onSelectOrder={onSelectOrder}
                  onSelectLines={onSelectLines}
                />
              </tr>
            </Fragment>
          ))}

          {showTerms ? (
            <FooterLaneRow
              label="Rcv · terms"
              laneKey="rcvPlan"
              tone="rcv-plan"
              months={flow.months}
              colTotals={colTotals}
              showOrderCell
              rowSpan={rowSpan}
            />
          ) : null}
          <FooterLaneRow
            label="Rcv"
            laneKey="rcv"
            tone="rcv"
            months={flow.months}
            colTotals={colTotals}
            showOrderCell={!showTerms}
            rowSpan={rowSpan}
          />
          {showTerms ? (
            <FooterLaneRow
              label="Pay · terms"
              laneKey="payPlan"
              tone="pay-plan"
              months={flow.months}
              colTotals={colTotals}
              showOrderCell={false}
              rowSpan={rowSpan}
            />
          ) : null}
          <FooterLaneRow
            label="Pay"
            laneKey="pay"
            tone="pay"
            months={flow.months}
            colTotals={colTotals}
            showOrderCell={false}
            rowSpan={rowSpan}
          />
        </tbody>
      </table>
    </div>
  );
}
