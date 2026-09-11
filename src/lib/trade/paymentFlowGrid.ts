/**
 * Build month columns and RCV/PAY cells for the order-wise payment flow grid.
 * Actuals use receipt/due timing; plan rows always use contractual due month.
 */
import type { PaymentLine, OrderPaymentBucket } from "./paymentSchedule";

export type FlowMonthCol = {
  key: string;
  /** e.g. Sep 2026 */
  label: string;
  isCurrent: boolean;
};

export type FlowCell = {
  amountUsd: number;
  late: boolean;
  /** Max days late among installments in this cell */
  lateDays?: number;
  notReceived?: boolean;
  lines: PaymentLine[];
  /** Planned (terms) cell vs actual remittance cell */
  kind?: "plan" | "actual";
};

export type OrderFlowRow = {
  order: OrderPaymentBucket;
  rcv: Record<string, FlowCell>;
  pay: Record<string, FlowCell>;
  rcvPlan: Record<string, FlowCell>;
  payPlan: Record<string, FlowCell>;
  buyerTotalUsd: number;
  factoryTotalUsd: number;
};

export type OrderPaymentFlow = {
  months: FlowMonthCol[];
  rows: OrderFlowRow[];
  currentMonthKey: string;
};

export type FlowSideSort = "default" | "buyer" | "factory";

function monthNameLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m || 1) - 1, 1));
  return d.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthKeyFromIso(iso?: string, fallback = new Date()): string {
  const d = iso ? new Date(`${iso}T12:00:00`) : fallback;
  if (Number.isNaN(d.getTime())) {
    return `${fallback.getUTCFullYear()}-${String(fallback.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyCell(kind: "plan" | "actual" = "actual"): FlowCell {
  return { amountUsd: 0, late: false, lines: [], kind };
}

function addLine(cell: FlowCell, line: PaymentLine) {
  cell.amountUsd += line.amountUsd;
  cell.lines.push(line);
  if (line.daysLate != null && line.daysLate > 0) {
    cell.late = true;
    cell.lateDays = Math.max(cell.lateDays || 0, line.daysLate);
  }
  if (line.notReceived) {
    cell.notReceived = true;
    cell.late = true;
  }
  if (line.status === "overdue") {
    cell.late = true;
    cell.notReceived = true;
  }
}

function emptyMonthMap(
  months: FlowMonthCol[],
  kind: "plan" | "actual",
): Record<string, FlowCell> {
  const map: Record<string, FlowCell> = {};
  for (const col of months) map[col.key] = emptyCell(kind);
  return map;
}

/** Compact USD for grid cells (e.g. 1.10M, 900k). */
export function flowAmountLabel(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}M`;
  }
  if (abs >= 1000) return `${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function buildOrderPaymentFlow(
  orders: OrderPaymentBucket[],
  asOf = new Date(),
): OrderPaymentFlow {
  const asOfKey = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`;
  const keySet = new Set<string>();
  for (const o of orders) {
    for (const l of o.lines) {
      keySet.add(l.monthKey);
      if (l.dueDate) keySet.add(monthKeyFromIso(l.dueDate, asOf));
    }
  }
  const [y, m] = asOfKey.split("-").map(Number);
  for (let i = -6; i <= 5; i++) {
    const d = new Date(Date.UTC(y!, m! - 1 + i, 1));
    keySet.add(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  const months: FlowMonthCol[] = [...keySet].sort().map((key) => ({
    key,
    label: monthNameLabel(key),
    isCurrent: key === asOfKey,
  }));

  const rows: OrderFlowRow[] = orders.map((order) => {
    const rcv = emptyMonthMap(months, "actual");
    const pay = emptyMonthMap(months, "actual");
    const rcvPlan = emptyMonthMap(months, "plan");
    const payPlan = emptyMonthMap(months, "plan");

    let buyerTotalUsd = 0;
    let factoryTotalUsd = 0;

    for (const line of order.lines) {
      if (line.side === "buyer") buyerTotalUsd += line.amountUsd;
      else factoryTotalUsd += line.amountUsd;

      const actualBucket = line.side === "buyer" ? rcv : pay;
      const actualCell = actualBucket[line.monthKey] || emptyCell("actual");
      addLine(actualCell, line);
      actualBucket[line.monthKey] = actualCell;

      const planKey = monthKeyFromIso(line.dueDate || line.monthKey, asOf);
      const planBucket = line.side === "buyer" ? rcvPlan : payPlan;
      const planCell = planBucket[planKey] || emptyCell("plan");
      addLine(planCell, line);
      // Plan rows are contractual — don't paint late styling from actual lag
      planCell.late = false;
      planCell.lateDays = undefined;
      planCell.notReceived = false;
      planBucket[planKey] = planCell;
    }

    return {
      order,
      rcv,
      pay,
      rcvPlan,
      payPlan,
      buyerTotalUsd,
      factoryTotalUsd,
    };
  });

  return { months, rows, currentMonthKey: asOfKey };
}

export function sortFlowRows(
  rows: OrderFlowRow[],
  sort: FlowSideSort,
): OrderFlowRow[] {
  const copy = [...rows];
  if (sort === "buyer") {
    return copy.sort((a, b) => b.buyerTotalUsd - a.buyerTotalUsd);
  }
  if (sort === "factory") {
    return copy.sort((a, b) => b.factoryTotalUsd - a.factoryTotalUsd);
  }
  return copy;
}

/** Sum amounts across months for one lane map. */
export function sumLaneCells(
  cells: Record<string, FlowCell>,
  months: FlowMonthCol[],
): number {
  return months.reduce((a, m) => a + (cells[m.key]?.amountUsd || 0), 0);
}

export type FlowLaneKey = "rcv" | "pay" | "rcvPlan" | "payPlan";

/** Per-month totals across all orders for each lane. */
export function columnLaneTotals(
  rows: OrderFlowRow[],
  months: FlowMonthCol[],
): Record<FlowLaneKey, Record<string, number>> {
  const empty = (): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const m of months) map[m.key] = 0;
    return map;
  };
  const totals: Record<FlowLaneKey, Record<string, number>> = {
    rcv: empty(),
    pay: empty(),
    rcvPlan: empty(),
    payPlan: empty(),
  };
  for (const row of rows) {
    for (const m of months) {
      totals.rcv[m.key]! += row.rcv[m.key]?.amountUsd || 0;
      totals.pay[m.key]! += row.pay[m.key]?.amountUsd || 0;
      totals.rcvPlan[m.key]! += row.rcvPlan[m.key]?.amountUsd || 0;
      totals.payPlan[m.key]! += row.payPlan[m.key]?.amountUsd || 0;
    }
  }
  return totals;
}

export function sumMonthMap(
  byMonth: Record<string, number>,
  months: FlowMonthCol[],
): number {
  return months.reduce((a, m) => a + (byMonth[m.key] || 0), 0);
}
