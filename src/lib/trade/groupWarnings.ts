import type { EarlyWarning } from "@/lib/trade/earlyWarnings";

export type WarningGroup = {
  key: string;
  severity: EarlyWarning["severity"];
  title: string;
  reason: string;
  items: EarlyWarning[];
};

/**
 * Collapse warnings that say the same thing ("Delivery at risk · Sail date
 * passed, no arrival date") into one row with the deals underneath, so 98
 * identical cards become one line with a count. Critical first, then the
 * biggest groups.
 */
export function groupWarnings(rows: EarlyWarning[]): WarningGroup[] {
  const byKey = new Map<string, WarningGroup>();
  for (const row of rows) {
    const key = `${row.severity}|${row.title}|${row.reason}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, severity: row.severity, title: row.title, reason: row.reason, items: [] };
      byKey.set(key, g);
    }
    // Same deal can surface twice from different sources; show it once.
    if (!g.items.some((it) => it.dealId && it.dealId === row.dealId && it.dealCode === row.dealCode)) {
      g.items.push(row);
    }
  }
  const rank = (s: EarlyWarning["severity"]) => (s === "critical" ? 0 : 1);
  return [...byKey.values()].sort(
    (a, b) => rank(a.severity) - rank(b.severity) || b.items.length - a.items.length,
  );
}
