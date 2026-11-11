/**
 * Short, copy-safe deal links: /deals/<code>~<hash>, e.g. /deals/PO-3827380~k2f9.
 *
 * Mailbox deal ids can be 100+ characters ("mb-topic_bectors_food_waldo_po_no…"),
 * which language models mis-copy. The Copilot links with this short key and the
 * deal room resolves it back to the deal. The hash keeps deals that share a code
 * (several mail threads about one PO) apart.
 */
import type { Deal } from "@/types/trade";

function hash4(s: string): string {
  // FNV-1a 32-bit → base36, 4 chars.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(4, "0").slice(-4);
}

export function shortDealKey(deal: Pick<Deal, "id" | "code">): string {
  const code = (deal.code || "deal").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || "deal";
  return `${code}~${hash4(deal.id)}`;
}

export function shortDealHref(deal: Pick<Deal, "id" | "code">): string {
  return `/deals/${shortDealKey(deal)}`;
}

/** Find a deal by its full id or its short key. */
export function findDealByRef<T extends Pick<Deal, "id" | "code">>(
  deals: T[],
  ref: string,
): T | undefined {
  if (!ref) return undefined;
  const direct = deals.find((d) => d.id === ref);
  if (direct) return direct;
  if (!ref.includes("~")) return undefined;
  return deals.find((d) => shortDealKey(d) === ref);
}
