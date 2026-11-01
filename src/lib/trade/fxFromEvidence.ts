/**
 * Extract agreed USD→INR FX from deal source emails (display overlay only).
 */
import type { Deal } from "@/types/trade";

export type FxSource = "email" | "internet" | "default";

export type DealFxRate = {
  rate: number;
  source: FxSource;
  excerpt?: string;
  asOfDate?: string;
};

const PATTERNS: RegExp[] = [
  /(?:usd\s*[\/\s]*inr|inr\s*[\/\s]*usd|\$\s*\/\s*₹|rs\.?\s*\/\s*usd)\s*[:=@]?\s*(\d{2}(?:\.\d{1,4})?)/i,
  /(?:1\s*(?:usd|us\$|\$)\s*=\s*)(\d{2}(?:\.\d{1,4})?)\s*(?:inr|rs\.?|₹)/i,
  /(\d{2}(?:\.\d{1,4})?)\s*(?:inr|rs\.?|₹)\s*(?:per|=|\/)\s*(?:usd|us\$|\$|dollar)/i,
  /(?:fx|exchange|conversion)\s*(?:rate)?\s*[:=]?\s*(\d{2}(?:\.\d{1,4})?)\s*(?:inr|rs\.?)?/i,
  /(\d{2}\.\d{2,4})\s*(?:inr\s*\/\s*usd|rs\s*\/\s*usd)/i,
  /(?:agreed|decided|fixed|apply(?:ing)?)\s+(?:fx|rate|conversion)[^\d]{0,24}(\d{2}(?:\.\d{1,4})?)/i,
  /(?:commission|invoice)\s+(?:at|@)\s*(?:rs\.?|₹|inr)?\s*(\d{2}(?:\.\d{1,4})?)/i,
];

function plausibleRate(n: number): boolean {
  return Number.isFinite(n) && n >= 50 && n <= 120;
}

function scanText(text: string): { rate: number; excerpt: string } | null {
  if (!text?.trim()) return null;
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const rate = Number(m[1]);
    if (!plausibleRate(rate)) continue;
    const idx = m.index ?? 0;
    const excerpt = text
      .slice(Math.max(0, idx - 40), idx + (m[0]?.length || 0) + 40)
      .replace(/\s+/g, " ")
      .trim();
    return { rate, excerpt };
  }
  return null;
}

/** Prefer email-agreed FX from loaded sources. */
export function extractFxFromDeal(deal: Deal): DealFxRate | null {
  const chunks: string[] = [];
  for (const s of deal.sources || []) {
    if (s.body) chunks.push(s.body);
    if (s.extractedSummary) chunks.push(s.extractedSummary);
    if (s.subject) chunks.push(s.subject);
  }
  if (deal.commission && "fxRate" in deal.commission && deal.commission.fxRate) {
    chunks.unshift(String(deal.commission.fxRate));
  }
  for (const text of chunks) {
    const hit = scanText(text);
    if (hit) {
      return {
        rate: hit.rate,
        source: "email",
        excerpt: hit.excerpt,
        asOfDate: deal.updatedAt || deal.createdAt,
      };
    }
  }
  return null;
}

export function dealFxAsOfDate(deal: Deal): string {
  const raw =
    deal.payment?.dueDate ||
    deal.booking?.eta ||
    deal.updatedAt ||
    deal.createdAt ||
    new Date().toISOString();
  return raw.slice(0, 10);
}

export function formatFxBadge(fx: DealFxRate): string {
  if (fx.source === "email") return `FX from email · ${fx.rate}`;
  if (fx.source === "internet")
    return `Internet rate · not from email · ${fx.rate}`;
  return `Default FX · ${fx.rate}`;
}
