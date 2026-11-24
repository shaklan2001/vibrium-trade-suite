import { ALL_STAGES, type Deal, type DealStage, type Party } from "@/types/trade";

/**
 * Human-facing labels for a deal. The extract's `title` is a long AI summary
 * sentence; lists and headers need a short name people recognise instead.
 */

const SUBJECT_NOISE = /^(?:\s*(?:re|fw|fwd|aw|wg|tr)\s*:\s*)+/i;

/** "RE: FW: Thermacool 1st container -- planning" → "Thermacool 1st container planning". */
export function cleanSubject(subject: string | undefined | null): string {
  if (!subject) return "";
  return calmCaps(subject)
    .replace(SUBJECT_NOISE, "")
    .replace(/\s*[-_=>]{2,}\s*/g, " · ")
    .replace(/\s*\/\/\s*/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/^[\s·]+|[\s·]+$/g, "")
    .trim();
}

/** "SHIPMENT STATUS FOR PO 4510" → "Shipment status for PO 4510"; mixed case is left alone. */
function calmCaps(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, "");
  const upper = text.replace(/[^A-Z]/g, "");
  if (letters.length < 8 || upper.length / letters.length < 0.8) return text;
  const lowered = text
    .split(/(\s+)/)
    // Keep codes (PO, HQ, 40FT, CBM) and anything with digits as written.
    .map((w) => (/\d/.test(w) || /^[A-Z]{2,4}[.:,]?$/.test(w) ? w : w.toLowerCase()))
    .join("");
  return lowered.replace(/[a-z]/, (c) => c.toUpperCase());
}

function firstParty(deal: Deal, roles: Party["role"][]): Party | undefined {
  return deal.parties.find((p) => roles.includes(p.role) && (p.company || p.name));
}

function partyLabel(p: Party | undefined): string {
  return (p?.company || p?.name || "").trim();
}

export function dealBuyer(deal: Deal): string {
  return partyLabel(firstParty(deal, ["buyer"]));
}

export function dealSupplier(deal: Deal): string {
  return partyLabel(firstParty(deal, ["factory", "trader"]));
}

/** Short title for lists and headers: newest mail subject, else first clause of the summary. */
export function dealHeadline(deal: Deal): string {
  const subjects = [...(deal.sources || [])]
    .sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""))
    .map((s) => cleanSubject(s.subject))
    .filter((s) => s.length >= 6);
  if (subjects[0]) return clip(subjects[0], 90);
  const timelineTitle = cleanSubject(deal.timeline?.[0]?.title);
  if (timelineTitle.length >= 6) return clip(timelineTitle, 90);
  const firstClause = (deal.title || "").split(/(?<=[.;])\s/)[0] || deal.title || deal.code;
  return clip(firstClause.replace(/[.;]$/, ""), 90);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).trim()}…`;
}

export function dealValueUsd(deal: Deal): number {
  return deal.paymentSchedule?.orderValueUsd || 0;
}

/** Newest dated activity on the deal (mail or timeline), ISO string. */
export function dealLastActivity(deal: Deal): string | null {
  // Mail and timeline only: updatedAt is when the book was last loaded.
  const dates = [
    ...(deal.sources || []).map((s) => s.receivedAt),
    ...(deal.timeline || []).map((t) => t.at),
  ].filter((d): d is string => Boolean(d) && Number.isFinite(Date.parse(d!)));
  if (!dates.length) return null;
  return dates.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
}

/** "Today", "Yesterday", "4 days ago", "12 Oct", "12 Oct 2024". */
export function relativeDay(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const days = Math.floor((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 1-based position of the stage in the 12-step flow. */
export function stageStep(stage: DealStage): { step: number; total: number } {
  return { step: ALL_STAGES.indexOf(stage) + 1, total: ALL_STAGES.length };
}

/** Compact USD: $9.3M, $412k, $860. */
export function compactUsd(n: number): string {
  if (!n) return "—";
  const trim = (x: number) => {
    const s = Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };
  if (Math.abs(n) >= 1e6) return `$${trim(n / 1e6)}M`;
  if (Math.abs(n) >= 1e3) return `$${trim(n / 1e3)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
