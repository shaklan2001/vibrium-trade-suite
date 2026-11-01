/**
 * Link mailbox extracts that share a PO number so booking/docs rows inherit
 * commercial value from PI/PO rows — enables Agency commission-after-shipment KPIs.
 */
import type { Deal } from "@/types/trade";
import { isLocalChargesNarrative } from "./localCharges";

function poKeys(deal: Deal): string[] {
  const keys = new Set<string>();
  for (const p of deal.mailboxPoNumbers || []) {
    const k = p.replace(/\s+/g, "").toUpperCase();
    if (k) keys.add(k);
  }
  const code = (deal.code || "").replace(/^PO-/i, "").replace(/\s+/g, "").toUpperCase();
  if (code && deal.code?.toUpperCase().startsWith("PO-")) keys.add(code);
  return [...keys];
}

function commercialOf(deal: Deal): number {
  const blob = `${deal.pi?.summary || ""} ${deal.po?.summary || ""} ${deal.economics?.summary || ""} ${deal.economics?.liquidityNote || ""}`;
  if (isLocalChargesNarrative(blob)) {
    return deal.payment?.amountUsd || deal.economics?.commercialValueUsd || 0;
  }
  return (
    deal.economics?.commercialValueUsd ||
    deal.payment?.amountUsd ||
    deal.po?.totalAmount ||
    deal.pi?.totalAmount ||
    0
  );
}

/**
 * Enrich deals in-place (returns same array). Booking/shipped rows without
 * commercial $ pick up the best PI/PO value for the same PO.
 */
export function enrichMailboxDeals(deals: Deal[]): Deal[] {
  const valueByPo = new Map<string, { amount: number; donor: Deal }>();
  for (const d of deals) {
    const amount = commercialOf(d);
    if (!(amount > 0)) continue;
    for (const key of poKeys(d)) {
      const prev = valueByPo.get(key);
      if (!prev || amount > prev.amount) valueByPo.set(key, { amount, donor: d });
    }
  }

  return suppressDuplicateOutstandings(deals.map((d) => {
    if (commercialOf(d) > 0) return d;
    let best: { amount: number; donor: Deal } | undefined;
    for (const key of poKeys(d)) {
      const hit = valueByPo.get(key);
      if (hit && (!best || hit.amount > best.amount)) best = hit;
    }
    if (!best) return d;

    const amount = best.amount;
    const paid = d.payment?.status === "paid";
    const economics = {
      commercialValueUsd: amount,
      agencyCommissionUsd: Math.round(amount * 0.05 * 100) / 100,
      cycleDaysTypical: 60,
      cycleDaysElapsed: d.economics?.cycleDaysElapsed || 30,
      commercialCashAtRiskUsd: 0,
      agencyCashAtRiskUsd: 0,
      agencyInflowNext14dUsd: paid ? 0 : amount * 0.05,
      riskRewardRatio: 1 as const,
      affordability: "comfortable" as const,
      liquidityNote: `Commercial value linked from ${best.donor.code}`,
      sources: [] as [],
      summary: d.economics?.summary || d.title,
    };

    // Ensure payment schedule exists for finance grids when we now have value
    const paymentSchedule =
      d.paymentSchedule ||
      ({
        buyerTerms: best.donor.paymentSchedule?.buyerTerms || "Linked from commercial extract",
        factoryTerms: best.donor.paymentSchedule?.factoryTerms,
        currency: best.donor.payment?.currency || best.donor.po?.currency || "USD",
        orderValueUsd: amount,
        checkpoints: [
          {
            id: `${d.id}-linked`,
            side: "buyer" as const,
            label: "Commercial value (linked PO)",
            percent: 100,
            amountUsd: Math.round(amount),
            dueDate: d.booking?.etd || d.payment?.dueDate || d.updatedAt?.slice(0, 10),
            status: (paid ? "received" : "upcoming") as
              | "received"
              | "upcoming",
            checkpoint: "Linked PI/PO",
          },
        ],
      } satisfies NonNullable<Deal["paymentSchedule"]>);

    return {
      ...d,
      economics,
      paymentSchedule,
      po: d.po || best.donor.po,
      pi: d.pi || best.donor.pi,
      payment: d.payment || {
        status: "pending",
        amountUsd: amount,
        currency: best.donor.payment?.currency || best.donor.po?.currency || "USD",
        summary: `Linked commercial value from ${best.donor.code}`,
      },
    };
  }));
}

const PARTY_TOKEN =
  /global praise|cottonsmiths|cotton smiths|waldos|grupo vizion|shetler|swastik|petrageous|loving pets|jay pee|ruparel|homeline|allana|neater|shetler housewares/i;

function normSubject(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(re|fw|fwd|urgent)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function amountPhrase(amount: number): string {
  const fixed = amount.toFixed(2);
  const [whole, frac] = fixed.split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  return frac === "00" ? grouped : `${grouped}.${frac}`;
}

function mailSubject(deal: Deal): string {
  const fromSources = (deal.sources || [])
    .map((source) => source.subject || "")
    .filter(Boolean)
    .join(" ");
  return fromSources || deal.title || "";
}

function sameOutstanding(a: Deal, b: Deal, amount: number): boolean {
  const phrase = amountPhrase(amount);
  const ta = `${mailSubject(a)}\n${a.title}\n${a.payment?.summary || ""}`;
  const tb = `${mailSubject(b)}\n${b.title}\n${b.payment?.summary || ""}`;
  if (!ta.includes(phrase) || !tb.includes(phrase)) return false;
  const na = normSubject(mailSubject(a));
  const nb = normSubject(mailSubject(b));
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 24 && (long.includes(short) || short.slice(0, 48) === long.slice(0, 48))) {
    return true;
  }
  const partyA = ta.match(PARTY_TOKEN)?.[0]?.toLowerCase();
  const partyB = tb.match(PARTY_TOKEN)?.[0]?.toLowerCase();
  return Boolean(partyA && partyB && partyA === partyB);
}

/**
 * The same outstanding statement sometimes lands as two mailbox threads
 * (USD 124,852.30 and USD 118,426.22). Keep the latest thread's money.
 */
function suppressDuplicateOutstandings(deals: Deal[]): Deal[] {
  const groups = new Map<number, Deal[]>();
  for (const deal of deals) {
    if (deal.mailboxSlot !== "payment_clock") continue;
    const amount = deal.payment?.amountUsd || deal.economics?.commercialValueUsd || 0;
    if (amount < 1000) continue;
    const key = Math.round(amount * 100);
    const list = groups.get(key) || [];
    list.push(deal);
    groups.set(key, list);
  }

  const drop = new Map<string, string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const amount = list[0]!.payment?.amountUsd || list[0]!.economics?.commercialValueUsd || 0;
    const used = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const seed = list[i]!;
      if (used.has(seed.id)) continue;
      const cluster = [seed];
      for (let j = i + 1; j < list.length; j++) {
        const other = list[j]!;
        if (used.has(other.id)) continue;
        if (cluster.some((item) => sameOutstanding(item, other, amount))) {
          cluster.push(other);
        }
      }
      if (cluster.length < 2) continue;
      cluster.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const keeper = cluster[0]!;
      used.add(keeper.id);
      for (const loser of cluster.slice(1)) {
        used.add(loser.id);
        drop.set(loser.id, keeper.code);
      }
    }
  }
  if (drop.size === 0) return deals;

  return deals.map((deal) => {
    const keeper = drop.get(deal.id);
    if (!keeper) return deal;
    const note = `Same outstanding already counted on ${keeper}.`;
    return {
      ...deal,
      economics: deal.economics
        ? {
            ...deal.economics,
            commercialValueUsd: 0,
            agencyCommissionUsd: 0,
            commercialCashAtRiskUsd: 0,
            agencyInflowNext14dUsd: 0,
            liquidityNote: note,
          }
        : deal.economics,
      paymentSchedule: undefined,
      payment: deal.payment
        ? {
            ...deal.payment,
            amountUsd: 0,
            summary: `${deal.payment.summary || ""}\n\n${note}`.trim(),
          }
        : deal.payment,
      cashExposure: deal.cashExposure
        ? {
            ...deal.cashExposure,
            pipelineCommitmentUsd: 0,
            cashDeployedUsd: 0,
            cashStillRequiredUsd: 0,
            receivableExpectedUsd: 0,
            receivableStatus: "none",
          }
        : deal.cashExposure,
    };
  });
}
