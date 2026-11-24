/**
 * Agreed ready date vs the date the cargo actually sailed, per deal.
 *
 * Agreed: PO ready date, else PI ready date, else the production worker's ready date.
 * Actual: a "shipped on board" / "sailed on" / "vessel departed" date found in a bill of lading text
 * or in a mail; the booking's ETD is used only once the shipment is known to have sailed.
 * The first confirmed date wins and keeps the message it came from. Client-safe and pure.
 */
import type { Deal } from "@/types/trade";
import { normDate } from "./normalize";

export type SailingText = { id: string; text: string; date?: string | null; kind: "document" | "mail" };

export type Sailing = {
  agreedReady: string | null;
  actualSail: string | null;
  /** actualSail minus agreedReady in days; negative = sailed before the agreed date. */
  daysVsAgreed: number | null;
  source: "document" | "mail" | "booking" | null;
  messageId: string | null;
};

const DATE_TOKEN =
  "(\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?[\\s-]+[A-Za-z]{3,9}[\\s,-]*(?:\\d{2,4})?|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*(?:\\d{2,4})?)";

const SAIL_PATTERNS = [
  new RegExp(`(?:shipped\\s+on\\s+board|on\\s+board\\s+date|date\\s+of\\s+shipment|laden\\s+on\\s+board)[^\\n\\d]{0,25}${DATE_TOKEN}`, "i"),
  new RegExp(`(?:vessel|ship|cargo|container|shipment)?\\s*(?:has\\s+|was\\s+)?(?:sailed|departed|left)\\s*(?:on|from [A-Za-z ]{3,30} on)?\\s*${DATE_TOKEN}`, "i"),
  new RegExp(`(?:sob|sailing\\s+confirmation|sailed\\s+out)[^\\n\\d]{0,20}${DATE_TOKEN}`, "i"),
];

/** First "sailed" date in a text, as YYYY-MM-DD, or null. */
export function sailDateIn(text: string, fallbackYear?: number): string | null {
  for (const re of SAIL_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const d = normDate(m[1]!.trim().replace(/[,.]$/, ""), fallbackYear);
    if (d) return d;
  }
  return null;
}

const dayMs = 86_400_000;

function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / dayMs);
}

export function agreedReadyDate(deal: Deal): string | null {
  for (const raw of [deal.po?.readyDate, deal.pi?.readyDate, deal.production?.readyDate]) {
    const d = normDate(raw || "");
    if (d) return d;
  }
  return null;
}

/**
 * Agreed vs actual for one deal. `texts` are bill-of-lading texts and mails to read; the deal's own
 * source mails are always read too.
 */
export function dealSailing(deal: Deal, texts: SailingText[] = []): Sailing {
  const agreedReady = agreedReadyDate(deal);
  const pool: SailingText[] = [
    ...texts,
    ...(deal.sources || []).map((s) => ({
      id: s.messageId || s.id,
      text: `${s.subject || ""}\n${s.body || ""}`,
      date: s.receivedAt || null,
      kind: "mail" as const,
    })),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let actualSail: string | null = null;
  let source: Sailing["source"] = null;
  let messageId: string | null = null;
  // Documents first (a bill of lading is the proof), then the oldest mail that says it sailed.
  for (const kind of ["document", "mail"] as const) {
    for (const t of pool.filter((p) => p.kind === kind)) {
      const year = t.date ? Number(t.date.slice(0, 4)) : undefined;
      const d = sailDateIn(t.text, year);
      if (d) {
        actualSail = d;
        source = kind;
        messageId = t.id;
        break;
      }
    }
    if (actualSail) break;
  }
  // The booking's ETD counts only once the cargo is known to be on the water.
  const status = deal.booking?.shipmentStatus;
  if (!actualSail && deal.booking?.etd && (status === "in_waters" || status === "about_to_arrive" || status === "arrived")) {
    const d = normDate(deal.booking.etd);
    if (d) {
      actualSail = d;
      source = "booking";
    }
  }
  return {
    agreedReady,
    actualSail,
    daysVsAgreed: agreedReady && actualSail ? diffDays(actualSail, agreedReady) : null,
    source,
    messageId,
  };
}

/** "Agreed 20 Nov · sailed 13 Nov (7 days early)" for the deal page. */
export function sailingLabel(s: Sailing): string | null {
  if (!s.agreedReady && !s.actualSail) return null;
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const parts: string[] = [];
  if (s.agreedReady) parts.push(`Agreed ${fmt(s.agreedReady)}`);
  if (s.actualSail) {
    const delta = s.daysVsAgreed;
    const note = delta == null ? "" : delta === 0 ? " (on time)" : delta < 0 ? ` (${-delta} days early)` : ` (${delta} days late)`;
    parts.push(`sailed ${fmt(s.actualSail)}${note}`);
  }
  return parts.join(" · ");
}

/** Share of shipped deals with both dates known: the measure for the sailing item. */
export function sailingCoverage(deals: Deal[]): { shipped: number; known: number } {
  let shipped = 0;
  let known = 0;
  for (const deal of deals) {
    const s = dealSailing(deal);
    if (!s.actualSail) continue;
    shipped += 1;
    if (s.agreedReady) known += 1;
  }
  return { shipped, known };
}
