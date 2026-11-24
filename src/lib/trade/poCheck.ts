/**
 * PO check: sanity of the buyer's PO, and every later document compared against it.
 *
 * Rule: the first PO the buyer sent is the source of truth (the baseline). Whatever passes on to
 * the factory (factory PO, PI, invoice) must agree with it on what is being bought: items,
 * quantities, destination, currency, dates and parties. Prices may differ (the agent's
 * commission sits between the two), but a factory price above the buyer price is flagged.
 * A later buyer PO with different content is reported as a revision, never as the new baseline.
 *
 * Pure and client-safe. Used by the early warnings and the deal page.
 */
import type { CommercialDocument, CommercialLine, Deal } from "@/types/trade";
import { normDate, sameNumber } from "./normalize";

export type PoSeverity = "high" | "medium" | "low";

export type PoIssue = {
  field: string;
  severity: PoSeverity;
  message: string;
  baseline?: string | null;
  other?: string | null;
};

export type DocRef = { label: string; docNumber: string | null; fileName: string | null; sentAt: string | null; side: string | null };

export type PoComparison = {
  doc: DocRef;
  /** "factory" = passed to the factory; "revision" = a later buyer PO. */
  kind: "factory" | "revision";
  issues: PoIssue[];
};

export type PoCheck = {
  baseline: DocRef | null;
  /** Problems inside the baseline PO itself. */
  sanity: PoIssue[];
  comparisons: PoComparison[];
  /** Every issue, worst first. */
  all: PoIssue[];
  /** True when at least one high issue exists anywhere. */
  hasHigh: boolean;
};

const AMOUNT_TOLERANCE = 0.02;
const LINE_TOLERANCE = 0.01;

const compact = (s: string | undefined | null) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const STOP = new Set(["pvt", "private", "ltd", "limited", "llc", "inc", "co", "corp", "corporation", "the", "and", "india", "company", "trading", "exports", "export", "imports", "import"]);
const words = (s: string | undefined | null) => (s || "").toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) || [];
const money = (n: number | undefined | null, cur?: string | null) => (n == null ? null : `${cur ? `${cur} ` : ""}${Math.round(n * 100) / 100}`);

function ref(d: CommercialDocument): DocRef {
  return {
    label: d.docNumber || d.fileName || d.docType.toUpperCase(),
    docNumber: d.docNumber ?? null,
    fileName: d.fileName ?? null,
    sentAt: d.sentAt ?? null,
    side: d.side ?? null,
  };
}

function allDocs(deal: Deal): CommercialDocument[] {
  const out: CommercialDocument[] = [];
  const seen = new Set<string>();
  for (const d of [...(deal.commercialDocs || []), ...(deal.po ? [deal.po] : []), ...(deal.pi ? [deal.pi] : [])]) {
    const key = `${d.docType}|${d.side ?? ""}|${compact(d.docNumber)}|${d.fileName ?? ""}|${d.totalAmount ?? ""}|${d.sentAt ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

const isBuyerPo = (d: CommercialDocument) => d.docType === "po" && d.side !== "factory" && d.side !== "freight";
const isFactoryDoc = (d: CommercialDocument) => d.side === "factory" || (d.docType === "pi" && d.side !== "buyer" && d.side !== "freight");

/** The earliest buyer PO: the source of truth. Undated documents sort last. */
export function baselinePo(deal: Deal): CommercialDocument | null {
  const pos = allDocs(deal).filter(isBuyerPo);
  if (!pos.length) return null;
  return [...pos].sort((a, b) => (a.sentAt || "9999").localeCompare(b.sentAt || "9999"))[0] ?? null;
}

/** Basic sanity of one PO: required fields, line arithmetic, lines against the total. */
export function poSanity(po: CommercialDocument): PoIssue[] {
  const out: PoIssue[] = [];
  const cur = po.currency;
  if (!po.docNumber) out.push({ field: "docNumber", severity: "medium", message: "PO number not found" });
  if (!po.buyer && !po.consignee) out.push({ field: "buyer", severity: "medium", message: "Buyer name missing" });
  if (!po.currency) out.push({ field: "currency", severity: "medium", message: "Currency missing" });
  if (!po.sentAt && !po.readyDate) out.push({ field: "date", severity: "low", message: "No PO date or ready date" });
  if (po.totalAmount == null || po.totalAmount <= 0) out.push({ field: "totalAmount", severity: "high", message: "PO total missing" });
  if (!po.lines?.length) {
    out.push({ field: "lines", severity: "high", message: "No lines read from the PO" });
    return out;
  }
  let sum = 0;
  let sumable = true;
  for (const [i, l] of po.lines.entries()) {
    const n = i + 1;
    if (l.qty == null || l.qty <= 0) out.push({ field: `lines[${i}].qty`, severity: "medium", message: `Line ${n}: quantity missing` });
    if (l.unitPrice == null) out.push({ field: `lines[${i}].unitPrice`, severity: "low", message: `Line ${n}: unit price missing` });
    if (l.qty != null && l.unitPrice != null && l.amount != null) {
      const calc = l.qty * l.unitPrice;
      if (Math.abs(calc - l.amount) / Math.max(Math.abs(l.amount), 1) > LINE_TOLERANCE) {
        out.push({
          field: `lines[${i}].amount`,
          severity: "high",
          message: `Line ${n}: quantity × price is ${money(calc, cur)}, the line says ${money(l.amount, cur)}`,
          baseline: money(calc, cur),
          other: money(l.amount, cur),
        });
      }
    }
    const amt = l.amount ?? (l.qty != null && l.unitPrice != null ? l.qty * l.unitPrice : null);
    if (amt == null) sumable = false;
    else sum += amt;
  }
  if (sumable && po.totalAmount && Math.abs(sum - po.totalAmount) / po.totalAmount > AMOUNT_TOLERANCE) {
    out.push({
      field: "totalAmount",
      severity: "high",
      message: `Lines add up to ${money(sum, cur)}, the PO total is ${money(po.totalAmount, cur)}`,
      baseline: money(sum, cur),
      other: money(po.totalAmount, cur),
    });
  }
  return out;
}

const lineKey = (l: CommercialLine) => compact(l.itemCode) || words(l.description).slice(0, 4).join(" ");

function matchLine(line: CommercialLine, pool: CommercialLine[], used: Set<number>): number {
  const code = compact(line.itemCode);
  if (code) {
    const i = pool.findIndex((p, idx) => !used.has(idx) && compact(p.itemCode) === code);
    if (i >= 0) return i;
  }
  const w = new Set(words(line.description));
  if (!w.size) return -1;
  let best = -1;
  let bestShare = 0;
  pool.forEach((p, idx) => {
    if (used.has(idx)) return;
    const pw = words(p.description);
    if (!pw.length) return;
    const shared = pw.filter((x) => w.has(x)).length;
    const share = shared / Math.max(w.size, pw.length);
    if (share > bestShare) {
      bestShare = share;
      best = idx;
    }
  });
  return bestShare >= 0.5 ? best : -1;
}

function sameParty(a: string | undefined, b: string | undefined): boolean {
  const x = words(a);
  const y = new Set(words(b));
  if (!x.length || !y.size) return true;
  return x.some((w) => y.has(w));
}

const samePlace = (a: string | undefined, b: string | undefined) => {
  const x = words(a);
  const y = new Set(words(b));
  return !x.length || !y.size || x.some((w) => y.has(w));
};

/** Compare one document against the baseline PO. */
export function compareDocs(base: CommercialDocument, other: CommercialDocument, kind: "factory" | "revision"): PoIssue[] {
  const out: PoIssue[] = [];
  const cur = base.currency;
  const tag = kind === "factory" ? "factory document" : "later PO";
  if (base.currency && other.currency && base.currency.toUpperCase() !== other.currency.toUpperCase()) {
    out.push({ field: "currency", severity: "high", message: `Currency differs: buyer PO ${base.currency}, ${tag} ${other.currency}`, baseline: base.currency, other: other.currency });
  }
  // Lines: every baseline line must be on the other document with the same quantity.
  const used = new Set<number>();
  const sameCurrency = !base.currency || !other.currency || base.currency.toUpperCase() === other.currency.toUpperCase();
  for (const [i, line] of (base.lines || []).entries()) {
    const label = line.itemCode || line.description?.slice(0, 40) || `line ${i + 1}`;
    const j = matchLine(line, other.lines || [], used);
    if (j < 0) {
      if (other.lines?.length) out.push({ field: `lines[${i}]`, severity: "high", message: `${label} is on the buyer PO but not on the ${tag}`, baseline: label, other: null });
      continue;
    }
    used.add(j);
    const o = other.lines[j]!;
    if (line.qty != null && o.qty != null && !sameNumber(line.qty, o.qty, 0.001)) {
      out.push({ field: `lines[${i}].qty`, severity: "high", message: `${label}: buyer PO quantity ${line.qty}, ${tag} ${o.qty}`, baseline: String(line.qty), other: String(o.qty) });
    }
    if (compact(line.itemCode) && compact(o.itemCode) && compact(line.itemCode) !== compact(o.itemCode)) {
      out.push({ field: `lines[${i}].itemCode`, severity: "medium", message: `${label}: item code differs (${o.itemCode} on the ${tag})`, baseline: line.itemCode ?? null, other: o.itemCode ?? null });
    }
    if (sameCurrency && line.unitPrice != null && o.unitPrice != null) {
      const factoryDearer = kind === "factory" && o.unitPrice > line.unitPrice * (1 + LINE_TOLERANCE);
      const revisionMoved = kind === "revision" && !sameNumber(line.unitPrice, o.unitPrice, LINE_TOLERANCE);
      if (factoryDearer) {
        out.push({ field: `lines[${i}].unitPrice`, severity: "high", message: `${label}: factory price ${money(o.unitPrice, cur)} is above the buyer price ${money(line.unitPrice, cur)}`, baseline: money(line.unitPrice, cur), other: money(o.unitPrice, cur) });
      } else if (revisionMoved) {
        out.push({ field: `lines[${i}].unitPrice`, severity: "medium", message: `${label}: price changed from ${money(line.unitPrice, cur)} to ${money(o.unitPrice, cur)}`, baseline: money(line.unitPrice, cur), other: money(o.unitPrice, cur) });
      }
    }
  }
  if (base.lines?.length) {
    (other.lines || []).forEach((l, idx) => {
      if (used.has(idx)) return;
      const label = l.itemCode || l.description?.slice(0, 40) || lineKey(l) || `line ${idx + 1}`;
      out.push({ field: `lines[+${idx}]`, severity: "high", message: `${label} is on the ${tag} but not on the buyer PO`, baseline: null, other: label });
    });
  }
  // Totals: factory may be lower (commission); factory above buyer is wrong. A revision must not move.
  if (sameCurrency && base.totalAmount && other.totalAmount) {
    const gap = (other.totalAmount - base.totalAmount) / base.totalAmount;
    if (kind === "factory" && gap > AMOUNT_TOLERANCE) {
      out.push({ field: "totalAmount", severity: "high", message: `Factory total ${money(other.totalAmount, cur)} is above the buyer PO ${money(base.totalAmount, cur)}`, baseline: money(base.totalAmount, cur), other: money(other.totalAmount, cur) });
    } else if (kind === "revision" && Math.abs(gap) > AMOUNT_TOLERANCE) {
      out.push({ field: "totalAmount", severity: "medium", message: `Revised PO total ${money(other.totalAmount, cur)} differs from the first PO ${money(base.totalAmount, cur)}`, baseline: money(base.totalAmount, cur), other: money(other.totalAmount, cur) });
    }
  }
  if (base.totalCbm && other.totalCbm && !sameNumber(base.totalCbm, other.totalCbm, 0.05)) {
    out.push({ field: "totalCbm", severity: "medium", message: `CBM differs: ${base.totalCbm} vs ${other.totalCbm}`, baseline: String(base.totalCbm), other: String(other.totalCbm) });
  }
  const bd = normDate(base.readyDate || "");
  const od = normDate(other.readyDate || "");
  if (bd && od && bd !== od) {
    const days = Math.round((Date.parse(od) - Date.parse(bd)) / 86_400_000);
    out.push({ field: "readyDate", severity: days > 0 ? "high" : "low", message: `Ready date differs: buyer PO ${bd}, ${tag} ${od} (${days > 0 ? `${days} days later` : `${-days} days earlier`})`, baseline: bd, other: od });
  }
  if (!samePlace(base.pod, other.pod)) out.push({ field: "pod", severity: "high", message: `Destination differs: ${base.pod} vs ${other.pod}`, baseline: base.pod ?? null, other: other.pod ?? null });
  if (!samePlace(base.pol, other.pol)) out.push({ field: "pol", severity: "medium", message: `Loading port differs: ${base.pol} vs ${other.pol}`, baseline: base.pol ?? null, other: other.pol ?? null });
  if (base.incoterm && other.incoterm && compact(base.incoterm) !== compact(other.incoterm)) {
    out.push({ field: "incoterm", severity: "medium", message: `Incoterm differs: ${base.incoterm} vs ${other.incoterm}`, baseline: base.incoterm, other: other.incoterm });
  }
  if (kind === "revision" && base.paymentTerms && other.paymentTerms && compact(base.paymentTerms) !== compact(other.paymentTerms)) {
    out.push({ field: "paymentTerms", severity: "medium", message: `Payment terms changed: ${base.paymentTerms} → ${other.paymentTerms}`, baseline: base.paymentTerms, other: other.paymentTerms });
  }
  // The goods go to the same buyer: the factory document must name the buyer (or consignee) of the PO.
  const buyer = base.buyer || base.consignee;
  if (kind === "factory" && buyer && (other.buyer || other.consignee) && !sameParty(buyer, other.buyer) && !sameParty(buyer, other.consignee)) {
    out.push({ field: "buyer", severity: "high", message: `Buyer differs: PO ${buyer}, ${tag} ${other.buyer || other.consignee}`, baseline: buyer, other: other.buyer || other.consignee || null });
  }
  // The buyer's PO number should be quoted on what the factory was given.
  const poNo = compact(base.docNumber);
  if (kind === "factory" && poNo.length >= 3) {
    const haystack = compact(`${other.docNumber || ""} ${other.fileName || ""} ${other.summary || ""} ${other.raw ? JSON.stringify(other.raw) : ""}`);
    if (haystack && !haystack.includes(poNo)) {
      out.push({ field: "docNumber", severity: "low", message: `Buyer PO ${base.docNumber} is not quoted on the ${tag}`, baseline: base.docNumber ?? null, other: other.docNumber ?? null });
    }
  }
  return out;
}

const RANK: Record<PoSeverity, number> = { high: 0, medium: 1, low: 2 };

/** The full check for one deal. */
export function checkPo(deal: Deal): PoCheck {
  const base = baselinePo(deal);
  if (!base) return { baseline: null, sanity: [], comparisons: [], all: [], hasHigh: false };
  const docs = allDocs(deal).filter((d) => d !== base);
  const comparisons: PoComparison[] = [];
  for (const d of docs) {
    const kind = isBuyerPo(d) ? "revision" : isFactoryDoc(d) ? "factory" : null;
    if (!kind) continue;
    // A later copy of the same PO with nothing different is not a revision.
    const issues = compareDocs(base, d, kind).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    comparisons.push({ doc: ref(d), kind, issues });
  }
  const sanity = poSanity(base).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const all = [...sanity, ...comparisons.flatMap((c) => c.issues)].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { baseline: ref(base), sanity, comparisons, all, hasHigh: all.some((i) => i.severity === "high") };
}
