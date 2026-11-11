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
          "h-8 min-w-[4.25rem]",
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
        "relative flex h-8 min-w-[4.25rem] flex-col items-center justify-center rounded-md border px-1.5 text-[11px] font-semibold tabular-nums leading-tight",
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
      <div className="flex h-8 min-w-[4.25rem] items-center justify-center text-[11px] tabular-nums text-zinc-300">
        —
      </div>
    );
  }
  return (
    <div
      title={title || flowAmountLabel(amount)}
      className={cn(
        "flex h-8 min-w-[4.25rem] items-center justify-center rounded-md border px-1.5 text-[11px] font-bold tabular-nums",
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
    <tr className="flow-total border-t border-zinc-200 align-middle">
      {showOrderCell ? (
        <td
          rowSpan={rowSpan}
          className="flow-order align-middle text-xs font-semibold text-zinc-700"
        >
          Total
        </td>
      ) : null}
      <td
        className={cn(
          "flow-lane text-xs font-semibold",
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

type VisibleLaneId = FlowLaneKey;

const LANE_OPTIONS: Array<{
  id: VisibleLaneId;
  label: string;
  short: string;
  tone: "rcv" | "pay" | "rcv-plan" | "pay-plan";
  laneLabel: string;
  headerClass: string;
}> = [
  {
    id: "rcvPlan",
    label: "Rcv · terms",
    short: "Rcv · terms",
    tone: "rcv-plan",
    laneLabel: "RCV terms",
    headerClass: "text-sky-700",
  },
  {
    id: "rcv",
    label: "Rcv",
    short: "Rcv",
    tone: "rcv",
    laneLabel: "RCV",
    headerClass: "text-slate-500",
  },
  {
    id: "payPlan",
    label: "Pay · terms",
    short: "Pay · terms",
    tone: "pay-plan",
    laneLabel: "PAY terms",
    headerClass: "text-amber-800",
  },
  {
    id: "pay",
    label: "Pay",
    short: "Pay",
    tone: "pay",
    laneLabel: "PAY",
    headerClass: "text-zinc-500",
  },
];

const DEFAULT_VISIBLE: VisibleLaneId[] = [
  "rcvPlan",
  "rcv",
  "payPlan",
  "pay",
];

function LaneMultiselect({
  selected,
  onChange,
}: {
  selected: VisibleLaneId[];
  onChange: (next: VisibleLaneId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.length === LANE_OPTIONS.length
      ? "All lanes"
      : selected.length === 0
        ? "No lanes"
        : selected
            .map((id) => LANE_OPTIONS.find((o) => o.id === id)?.short)
            .filter(Boolean)
            .join(", ");

  function toggle(id: VisibleLaneId) {
    if (selected.includes(id)) {
      // Keep at least one lane visible
      if (selected.length === 1) return;
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange(
        LANE_OPTIONS.map((o) => o.id).filter(
          (x) => selected.includes(x) || x === id,
        ),
      );
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-w-[10rem] items-center justify-between gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-300"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">
          <span className="text-zinc-500">Lanes · </span>
          {summary}
        </span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 text-zinc-400" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 cursor-default"
            aria-label="Close lane menu"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-multiselectable
            className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-2.5 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Show lanes
              </span>
              <button
                type="button"
                className="text-[10px] font-medium text-teal-700 hover:underline"
                onClick={() => onChange([...DEFAULT_VISIBLE])}
              >
                All
              </button>
            </div>
            {LANE_OPTIONS.map((opt) => {
              const checked = selected.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    className="rounded border-zinc-300"
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                  />
                  <span className={cn("font-medium uppercase", opt.headerClass)}>
                    {opt.label}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

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
  const [visibleLanes, setVisibleLanes] =
    useState<VisibleLaneId[]>(DEFAULT_VISIBLE);
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

  const activeLanes = useMemo(
    () => LANE_OPTIONS.filter((o) => visibleLanes.includes(o.id)),
    [visibleLanes],
  );

  if (!orders.length) {
    return (
      <p className="px-3 py-6 text-sm text-zinc-500">
        No payment-term schedules on the open book yet.
      </p>
    );
  }

  const rowSpan = Math.max(activeLanes.length, 1);
  const showTerms = visibleLanes.some(
    (id) => id === "rcvPlan" || id === "payPlan",
  );
  const sortLabel =
    sideSort === "buyer"
      ? "Buyer RCV ↓"
      : sideSort === "factory"
        ? "Factory PAY ↓"
        : "Default";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-zinc-500">
          RCV = buyer · PAY = factory
          {showTerms ? " · dashed = PO/PI terms by due month" : ""} · current month highlighted
        </p>
        <LaneMultiselect selected={visibleLanes} onChange={setVisibleLanes} />
      </div>
      <div className="flow-scroll">
      <table className="text-left">
        <thead>
          <tr className="text-xs text-zinc-500">
            <th className="flow-order font-medium">
              Order
            </th>
            <th className="flow-lane font-medium">
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
          {rows.map((row) => {
            const { order, rcv, pay, rcvPlan, payPlan } = row;
            const cellsByLane: Record<VisibleLaneId, Record<string, FlowCell>> =
              {
                rcv,
                pay,
                rcvPlan,
                payPlan,
              };
            return (
              <Fragment key={order.dealId}>
                {activeLanes.map((lane, laneIdx) => {
                  const isLast = laneIdx === activeLanes.length - 1;
                  const cells = cellsByLane[lane.id];
                  return (
                    <tr
                      key={`${order.dealId}-${lane.id}`}
                      className={cn(
                        "align-middle",
                        isLast
                          ? "border-b border-zinc-200"
                          : "border-b border-zinc-50",
                      )}
                    >
                      {laneIdx === 0 ? (
                        <td
                          rowSpan={rowSpan}
                          className="flow-order align-middle"
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
                      <td
                        className={cn(
                          "flow-lane text-xs font-semibold",
                          lane.headerClass,
                        )}
                      >
                        {lane.label}
                      </td>
                      <LaneCells
                        months={flow.months}
                        cells={cells}
                        tone={lane.tone}
                        dealCode={order.dealCode}
                        laneLabel={lane.laneLabel}
                        order={order}
                        rowTotal={sumLaneCells(cells, flow.months)}
                        onSelectOrder={onSelectOrder}
                        onSelectLines={onSelectLines}
                      />
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}

          {activeLanes.map((lane, laneIdx) => (
            <FooterLaneRow
              key={`footer-${lane.id}`}
              label={lane.label}
              laneKey={lane.id}
              tone={lane.tone}
              months={flow.months}
              colTotals={colTotals}
              showOrderCell={laneIdx === 0}
              rowSpan={rowSpan}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
