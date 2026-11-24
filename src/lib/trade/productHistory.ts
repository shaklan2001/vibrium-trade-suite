/**
 * Product history: every line on every PO / PI / invoice in the book, searchable by description or
 * item code, so a quote request can be answered with who supplied it and what it last cost.
 *
 * `buildProductIndex` makes the flat list; `searchProducts` ranks it (item code exact, then word
 * overlap weighted by how rare the word is) and groups by vendor with the last prices.
 * Client-safe and pure.
 */
import type { Deal } from "@/types/trade";
import { dealSailing } from "./sailing";

export type ProductLine = {
  key: string;
  itemCode: string | null;
  description: string;
  words: string[];
  vendor: string | null;
  buyer: string | null;
  unitPrice: number | null;
  currency: string | null;
  qty: number | null;
  date: string | null;
  dealId: string;
  dealCode: string;
  docNumber: string | null;
  side: "buyer" | "factory" | "freight" | null;
};

export type ProductVendor = {
  vendor: string;
  lastPrices: { unitPrice: number; currency: string | null; qty: number | null; date: string | null; dealId: string; dealCode: string; docNumber: string | null }[];
  /** Deals this vendor shipped with their on-time record (days vs agreed ready date, negative = early). */
  deals: number;
  avgDaysLate: number | null;
};

export type ProductHit = {
  score: number;
  line: ProductLine;
};

export type ProductSearch = {
  query: string;
  hits: ProductHit[];
  vendors: ProductVendor[];
};

const STOP = new Set([
  "the", "and", "for", "with", "pcs", "piece", "pieces", "set", "sets", "size", "color", "colour", "assorted", "as", "per", "of", "in", "to", "a", "x",
  // Words that describe a request, not a product ("new items", "other options", "products discussed").
  "new", "item", "items", "other", "option", "options", "including", "include", "that", "can", "product", "products", "style", "type", "types",
  "kind", "kinds", "discussed", "development", "instead", "like", "similar", "different", "some", "any", "your", "our", "please", "price", "prices",
]);

/** Light stemmer so plurals and verb forms meet: handles → handle, scratching / scratcher → scratch, waldos → waldo. */
export function stem(w: string): string {
  if (/^\d/.test(w)) return w;
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 6 && w.endsWith("ers")) return w.slice(0, -3);
  if (w.length > 6 && w.endsWith("er")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Trade words that name a family of products: a request for “cookware” is answered by pots and pans. */
const FAMILY: Record<string, string[]> = {
  cookware: ["pot", "pan", "kadai", "casserole", "cookware", "wok", "saucepan"],
  utensil: ["pot", "pan", "kadai", "ladle", "spoon", "utensil"],
  treat: ["treat", "chew", "munchy", "rawhide", "stick", "bone"],
  towel: ["towel", "terry"],
};

export function wordsOf(text: string): string[] {
  return [
    ...new Set(
      (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map(stem)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ];
}

/** A request listing several products ("rawhide, body parts, munchy, or other chews") is also searched part by part. */
export function queryParts(query: string): string[] {
  const parts = (query || "")
    .split(/[,;\n]|\bor\b|\band\/or\b/i)
    .map((p) => p.trim())
    .filter((p) => wordsOf(p).length > 0);
  return parts.length > 1 ? [query, ...parts] : [query];
}

const cleanCode = (c: string | undefined) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** All priced lines in the book, newest first. Lines without a description or code are skipped. */
export function buildProductIndex(deals: Deal[]): ProductLine[] {
  const out: ProductLine[] = [];
  for (const deal of deals) {
    const docs = [...(deal.commercialDocs || []), ...(deal.po ? [deal.po] : []), ...(deal.pi ? [deal.pi] : [])];
    const seen = new Set<string>();
    for (const doc of docs) {
      for (const [i, l] of (doc.lines || []).entries()) {
        const description = (l.description || "").trim();
        const code = cleanCode(l.itemCode);
        if (!description && !code) continue;
        const key = `${deal.id}|${doc.docNumber || doc.fileName || doc.docType}|${code || description.slice(0, 40)}|${l.unitPrice ?? ""}|${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key,
          itemCode: code || null,
          description,
          words: wordsOf(`${description} ${l.itemCode || ""}`),
          vendor: doc.factory || doc.shipper || (doc.side === "factory" ? deal.pi?.factory : null) || null,
          buyer: doc.buyer || doc.consignee || null,
          // A zero or negative price is a placeholder on the document, not a price.
          unitPrice: typeof l.unitPrice === "number" && l.unitPrice > 0 ? l.unitPrice : null,
          currency: doc.currency ?? null,
          qty: l.qty ?? null,
          date: doc.sentAt?.slice(0, 10) || deal.updatedAt?.slice(0, 10) || null,
          dealId: deal.id,
          dealCode: deal.code,
          docNumber: doc.docNumber ?? null,
          side: doc.side ?? null,
        });
      }
    }
  }
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/** Vendors for a product with their last prices; `vendorRecord` adds each vendor's on-time record. */
export function searchProducts(
  index: ProductLine[],
  query: string,
  opts: { limit?: number; before?: string | null; vendorRecord?: Map<string, { deals: number; avgDaysLate: number | null }> } = {},
): ProductSearch {
  const limit = opts.limit ?? 12;
  const codeQ = (query.match(/\b[A-Za-z]{1,5}[-_ ]?\d{3,}[A-Za-z]?\b/g) || []).map(cleanCode);
  const pool = opts.before ? index.filter((l) => !l.date || l.date < opts.before!) : index;
  // Rare words count more: idf over the pool.
  const df = new Map<string, number>();
  for (const l of pool) for (const w of l.words) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w: string) => Math.log(1 + pool.length / (1 + (df.get(w) || 0)));
  // A word this rare (a product name such as “rawhide” or “munchy”) is enough on its own.
  const rareCut = Math.max(3, Math.round(pool.length * 0.004));
  const best = new Map<string, ProductHit>();
  for (const part of queryParts(query)) {
    const q = wordsOf(part);
    if (!q.length && !codeQ.length) continue;
    for (const line of pool) {
      let score = 0;
      if (line.itemCode && codeQ.includes(line.itemCode)) score += 20;
      const have = new Set(line.words);
      const shared: string[] = [];
      for (const w of q) {
        const family = FAMILY[w] || [w];
        const hit = family.find((f) => have.has(f));
        if (hit) {
          shared.push(hit);
          score += idf(hit);
        }
      }
      const share = q.length ? shared.length / q.length : 0;
      // The rare word must be the product itself: the last word of the request ("multi pack rawhide" → rawhide).
      const head = q[q.length - 1];
      const headHit = head ? (FAMILY[head] || [head]).find((f) => have.has(f)) : undefined;
      const rare = Boolean(headHit && (df.get(headHit) || 0) <= rareCut);
      // Need a code hit, or at least half the words (two when the query has several), or the product word itself when it is rare.
      const enough =
        codeQ.includes(line.itemCode || "~") ||
        (q.length > 0 && shared.length >= Math.min(2, q.length) && share >= 0.5) ||
        (rare && share >= 0.3);
      if (score <= 0 || !enough) continue;
      const prev = best.get(line.key);
      if (!prev || prev.score < score) best.set(line.key, { score, line });
    }
  }
  const hits = [...best.values()];
  hits.sort((a, b) => b.score - a.score || (b.line.date || "").localeCompare(a.line.date || ""));
  const top = hits.slice(0, limit);
  const byVendor = new Map<string, ProductVendor>();
  for (const { line } of hits) {
    if (!line.vendor || line.unitPrice == null) continue;
    const v = byVendor.get(line.vendor) || { vendor: line.vendor, lastPrices: [], deals: 0, avgDaysLate: null };
    if (v.lastPrices.length < 3) {
      v.lastPrices.push({
        unitPrice: line.unitPrice,
        currency: line.currency,
        qty: line.qty,
        date: line.date,
        dealId: line.dealId,
        dealCode: line.dealCode,
        docNumber: line.docNumber,
      });
    }
    byVendor.set(line.vendor, v);
  }
  for (const v of byVendor.values()) {
    const rec = opts.vendorRecord?.get(v.vendor);
    if (rec) {
      v.deals = rec.deals;
      v.avgDaysLate = rec.avgDaysLate;
    }
  }
  return { query, hits: top, vendors: [...byVendor.values()].slice(0, 6) };
}

/** Per-vendor on-time record: days between the agreed ready date and the sailing date. */
export function vendorRecords(deals: Deal[]): Map<string, { deals: number; avgDaysLate: number | null }> {
  const acc = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const deal of deals) {
    const vendor = deal.pi?.factory || deal.pi?.shipper || deal.po?.factory || null;
    if (!vendor) continue;
    counts.set(vendor, (counts.get(vendor) || 0) + 1);
    const s = dealSailing(deal);
    if (s.daysVsAgreed != null) acc.set(vendor, [...(acc.get(vendor) || []), s.daysVsAgreed]);
  }
  const out = new Map<string, { deals: number; avgDaysLate: number | null }>();
  for (const [vendor, deals] of counts) {
    const days = acc.get(vendor) || [];
    out.set(vendor, { deals, avgDaysLate: days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null });
  }
  return out;
}

/** Lines for the Copilot context: vendors and last prices for a product question. */
export function productHistoryLines(search: ProductSearch): string[] {
  if (!search.vendors.length) return [];
  const money = (p: { unitPrice: number; currency: string | null }) => `${p.currency || ""} ${p.unitPrice}`.trim();
  return search.vendors.map((v) => {
    const prices = v.lastPrices.map((p) => `${money(p)}${p.date ? ` (${p.date}, ${p.dealCode})` : ` (${p.dealCode})`}`).join("; ");
    const record = v.avgDaysLate == null ? "" : ` · sails ${v.avgDaysLate <= 0 ? `${-v.avgDaysLate} days early` : `${v.avgDaysLate} days late`} on average (${v.deals} deals)`;
    return `${v.vendor}: last prices ${prices}${record}`;
  });
}
