/**
 * Pick the deals a Copilot question is about, deterministically, from the
 * full in-memory book. No LLM, no LIKE over email bodies.
 */
import { dealMatchesCommercialModel, type CommercialModelFilter } from "@/lib/trade/commercialModel";
import { cleanPoNumber } from "@/lib/trade/dealReference";
import { findDealByRef } from "@/lib/trade/dealLink";
import { collectAllAttention, rankDeals } from "@/lib/trade/opsIntelligence";
import type { AttentionItem, Deal } from "@/types/trade";
import type { CopilotBook } from "./book";
import type { CopilotQuery } from "./query";

export type RetrievalMode = "deal" | "list" | "count" | "attention" | "product" | "overview" | "not_found";

export type Retrieval = {
  mode: RetrievalMode;
  /** Deals scoped by the header Book filter — basis for every total. */
  scope: Deal[];
  /** Deals shown in detail (deal mode) or as rows (list/attention). */
  deals: Deal[];
  /** Size of the full filtered set before trimming to rows. */
  matchedTotal: number;
  /** Human-readable explanation of how deals were chosen. */
  matchedBy: string[];
  /** Named references that matched nothing. */
  notFound: string[];
  /** Near matches for not-found PO numbers. */
  suggestions: Deal[];
  attention: AttentionItem[];
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** One definition of "overdue" for filters and totals alike. */
export function isPaymentOverdue(d: Deal): boolean {
  return (
    d.payment?.status === "overdue" ||
    d.cashExposure?.receivableStatus === "overdue" ||
    Boolean(d.paymentSchedule?.checkpoints?.some((c) => c.status === "overdue"))
  );
}

/** Several mail threads can share one deal code; show each code once in lists. */
function uniqueByCode(deals: Deal[]): Deal[] {
  const seen = new Set<string>();
  return deals.filter((d) => {
    const key = d.code || d.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tokens that identify parties, teammates, carriers, ports. Cached per book. */
const vocabCache = new WeakMap<CopilotBook, Set<string>>();
function entityVocab(book: CopilotBook): Set<string> {
  const hit = vocabCache.get(book);
  if (hit) return hit;
  const vocab = new Set<string>();
  const add = (s?: string) => {
    if (!s) return;
    for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3 && !/^\d+$/.test(t)) vocab.add(t);
    }
  };
  for (const d of book.deals) {
    for (const p of d.parties || []) {
      add(p.name);
      add(p.company);
      add(p.email);
    }
    for (const doc of [d.pi, d.po]) {
      add(doc?.buyer);
      add(doc?.factory);
      add(doc?.shipper);
      add(doc?.consignee);
    }
    add(d.booking?.carrier);
    add(d.booking?.vessel);
    add(d.booking?.pod);
    add(d.booking?.pol);
    // Mail header addresses (teammates such as kalpana@snspl.in).
    for (const m of (d.searchText || "").toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+/g)) {
      add(m[0]);
    }
  }
  vocabCache.set(book, vocab);
  return vocab;
}

function termIsEntity(term: string, vocab: Set<string>): boolean {
  if (vocab.has(term)) return true;
  if (term.length < 4) return false;
  for (const v of vocab) {
    if (v.startsWith(term) || (v.length >= 5 && term.startsWith(v))) return true;
  }
  return false;
}

function dealPos(d: Deal): string[] {
  const out = new Set<string>();
  for (const p of d.mailboxPoNumbers || []) {
    const c = cleanPoNumber(p);
    if (c) out.add(norm(c));
  }
  if (d.code?.startsWith("PO-")) out.add(norm(d.code.slice(3)));
  for (const doc of [d.pi, d.po, ...(d.commercialDocs || [])]) {
    if (doc?.docNumber) out.add(norm(doc.docNumber));
  }
  if (d.mailboxSourceId?.startsWith("po:")) {
    const c = cleanPoNumber(d.mailboxSourceId.slice(3));
    if (c) out.add(norm(c));
  }
  return [...out];
}

function byRecency(a: Deal, b: Deal) {
  return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
}

/** Order a list: most urgent first, then most recent. */
function rankForList(deals: Deal[]): Deal[] {
  if (deals.length <= 1) return deals;
  const score = new Map(rankDeals(deals).map((r) => [r.dealId, r.score]));
  return [...deals].sort(
    (a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0) || byRecency(a, b),
  );
}

function findByPo(scope: Deal[], po: string): Deal[] {
  const want = norm(po);
  const exact = scope.filter((d) => dealPos(d).includes(want));
  if (exact.length) return exact;
  // "14684" → 14684A / 14684B / 14684C (split shipments of one PO).
  if (want.length >= 4) {
    return scope.filter((d) => dealPos(d).some((p) => p.startsWith(want) && p.length - want.length <= 3));
  }
  return [];
}

function nearPos(scope: Deal[], po: string): Deal[] {
  const want = norm(po);
  const digits = want.replace(/\D/g, "");
  if (digits.length < 4) return [];
  const stem = digits.slice(0, -1);
  return scope
    .filter((d) => dealPos(d).some((p) => p.replace(/\D/g, "").startsWith(stem)))
    .sort(byRecency)
    .slice(0, 5);
}

export function retrieveForQuery(
  book: CopilotBook,
  q: CopilotQuery,
  ctx: {
    bookFilter?: CommercialModelFilter;
    focusDealId?: string;
    activeDealIds?: string[];
    listLimit?: number;
  } = {},
): Retrieval {
  const listLimit = ctx.listLimit ?? 15;
  const bookFilter: CommercialModelFilter = q.model || ctx.bookFilter || "all";
  const scope =
    bookFilter === "all"
      ? book.deals
      : book.deals.filter((d) => dealMatchesCommercialModel(d, bookFilter));

  const out: Retrieval = {
    mode: "overview",
    scope,
    deals: [],
    matchedTotal: 0,
    matchedBy: [],
    notFound: [],
    suggestions: [],
    attention: [],
  };
  if (bookFilter !== "all") out.matchedBy.push(`book filter: ${bookFilter}`);

  // 1. Deals named explicitly.
  const named: Deal[] = [];
  const addNamed = (ds: Deal[]) => {
    for (const d of ds) if (!named.includes(d)) named.push(d);
  };
  for (const po of q.poNumbers) {
    const hits = findByPo(scope, po);
    if (hits.length) {
      addNamed(hits);
      out.matchedBy.push(`PO ${po} → ${hits.map((d) => d.code).join(", ")}`);
    } else {
      out.notFound.push(`PO ${po}`);
      out.suggestions.push(...nearPos(scope, po).filter((d) => !out.suggestions.includes(d)));
    }
  }
  for (const code of q.dealCodes) {
    if (code.startsWith("PO-") && q.poNumbers.includes(cleanPoNumber(code.slice(3)) || "")) continue;
    const hits = scope.filter((d) => d.code?.toUpperCase() === code);
    if (hits.length) {
      addNamed(hits);
      out.matchedBy.push(`deal code ${code}`);
    } else out.notFound.push(`deal ${code}`);
  }
  for (const ref of [...q.bookingNumbers, ...q.containerNumbers]) {
    const r = ref.toLowerCase();
    const hits = scope.filter((d) => (book.index.get(d.id) || "").includes(r));
    if (hits.length) {
      addNamed(hits);
      out.matchedBy.push(`reference ${ref} → ${hits.length} deal(s)`);
    } else out.notFound.push(`reference ${ref}`);
  }

  if (named.length) {
    out.mode = "deal";
    out.deals = named.sort(byRecency);
    out.matchedTotal = named.length;
    return withAttention(out);
  }
  if (out.notFound.length && !q.terms.length && !q.stages.length) {
    out.mode = "not_found";
    return out;
  }

  // 2. Follow-ups and "this deal" resolve to the page deal or the last answer.
  // Page deal arrives as a full id or a short /deals/<code>~<hash> key.
  const focus = ctx.focusDealId
    ? book.byId.get(ctx.focusDealId) || findDealByRef(book.deals, ctx.focusDealId)
    : undefined;
  const active = (ctx.activeDealIds || [])
    .map((id) => book.byId.get(id))
    .filter((d): d is Deal => Boolean(d));
  const noFilters =
    !q.stages.length && !q.overdue && !q.docsMissing && !q.model && !q.terms.length;
  if (q.thisDeal && focus) {
    out.mode = "deal";
    out.deals = [focus];
    out.matchedTotal = 1;
    out.matchedBy.push(`deal open on screen (${focus.code})`);
    return withAttention(out);
  }
  // A question that names nothing of its own ("who is the forwarder?") is
  // about the deals in the previous answer.
  const bareFollowUp = (q.intent === "deal" || q.intent === "overview") && noFilters;
  const backRef = q.intent !== "product" && (q.refersBack || bareFollowUp);
  if (backRef) {
    const pick = active.length ? active : focus ? [focus] : [];
    if (pick.length) {
      // "which of them are overdue?" → filter the previous deals, not the book.
      let sel = pick;
      const narrowed: string[] = [];
      if (q.stages.length) {
        sel = sel.filter((d) => q.stages.includes(d.stage));
        narrowed.push(`stage ${q.stages.join("/")}`);
      }
      if (q.overdue) {
        sel = sel.filter(isPaymentOverdue);
        narrowed.push("overdue payment");
      }
      if (q.docsMissing) {
        sel = sel.filter((d) => (d.docsPack?.missing?.length || 0) > 0);
        narrowed.push("missing documents");
      }
      out.mode = "deal";
      out.deals = (sel.length ? sel : pick).slice(0, 4);
      out.matchedTotal = sel.length;
      out.matchedBy.push(
        active.length ? `follow-up on ${pick.map((d) => d.code).join(", ")}` : `deal open on screen (${pick[0].code})`,
      );
      if (narrowed.length) {
        out.matchedBy.push(
          sel.length
            ? `narrowed to ${narrowed.join(", ")}: ${sel.map((d) => d.code).join(", ")}`
            : `none of them have ${narrowed.join(", ")}`,
        );
      }
      return withAttention(out);
    }
  }

  // 3. Filters.
  let set = scope;
  const vocab = entityVocab(book);
  const entityTerms = q.terms.filter((t) => termIsEntity(t, vocab));
  for (const term of entityTerms) {
    const hits = set.filter((d) => (book.index.get(d.id) || "").includes(term));
    // Ignore terms that match nothing or almost everything.
    if (!hits.length || hits.length > set.length * 0.6) continue;
    set = hits;
    out.matchedBy.push(`"${term}"`);
  }
  if (q.stages.length) {
    set = set.filter((d) => q.stages.includes(d.stage));
    out.matchedBy.push(`stage: ${q.stages.join(" / ")}`);
  }
  if (q.overdue) {
    set = set.filter(isPaymentOverdue);
    out.matchedBy.push("overdue payments");
  }
  if (q.docsMissing) {
    set = set.filter((d) => (d.docsPack?.missing?.length || 0) > 0);
    out.matchedBy.push("documents missing");
  }

  const filtered = set !== scope;
  if (q.intent === "product") {
    out.mode = "product";
    return out;
  }
  if (q.intent === "attention" || (!filtered && q.intent === "overview")) {
    out.mode = q.intent === "attention" ? "attention" : "overview";
    const base = filtered ? set : scope;
    out.attention = collectAllAttention(base).filter((a) => a.severity !== "info");
    const ranked = rankDeals(base).slice(0, listLimit * 3);
    out.deals = uniqueByCode(
      ranked.map((r) => book.byId.get(r.dealId)).filter((d): d is Deal => Boolean(d)),
    ).slice(0, listLimit);
    out.matchedTotal = base.length;
    return out;
  }

  out.mode = q.intent === "count" ? "count" : "list";
  out.matchedTotal = set.length;
  out.deals = uniqueByCode(rankForList(set)).slice(0, q.intent === "count" ? 8 : listLimit);
  // A single hit is better answered with the full deal card.
  if (set.length === 1 && filtered) out.mode = "deal";
  if (out.mode === "deal") return withAttention(out);
  return out;
}

function withAttention(out: Retrieval): Retrieval {
  out.attention = collectAllAttention(out.deals);
  return out;
}
