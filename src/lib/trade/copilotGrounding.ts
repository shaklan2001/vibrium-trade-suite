/**
 * Copilot grounding: understand the question, pick the right deals from the
 * full book, and attach a compact, budgeted context block to the message.
 *
 *   parseCopilotQuery  → what is being asked (PO, stage, overdue, follow-up…)
 *   getCopilotBook     → whole book, cached, same numbers as Command Center
 *   retrieveForQuery   → which deals answer it (exact PO match, filters, totals)
 *   buildContextBlock  → deal cards / rows / totals + answer rules
 */
import type { CommercialModelFilter } from "@/lib/trade/commercialModel";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { buildContextBlock, dealHref } from "@/lib/trade/copilot/context";
import { withMailTrail } from "@/lib/trade/copilot/mailTrail";
import { bookWithPayments, getPaymentLedger, paymentLines } from "@/lib/trade/copilot/paymentsContext";
import { parseCopilotQuery, type CopilotQuery } from "@/lib/trade/copilot/query";
import { retrieveForQuery, type PersonFilter, type Retrieval } from "@/lib/trade/copilot/retrieve";
import { personInText } from "@/lib/trade/people/people";
import { getPeopleIndex } from "@/lib/trade/people/peopleStore";
import { noteTextsFor } from "@/lib/mail/dealRecords";
import type { NextActionState } from "@/lib/mail/nextAction";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import { productHistoryLines } from "@/lib/trade/productHistory";
import { searchProductHistory } from "@/lib/trade/productIndexStore";
import { dealSailing, sailingLabel } from "@/lib/trade/sailing";
import type { Deal } from "@/types/trade";

const USER_MSG_MAX = 2_000;

export type CopilotDealRef = { id: string; code: string; title: string; href: string };

export type GroundedChat = {
  message: string;
  /** Deals the answer is about — client shows "Open" chips and sends them back for follow-ups. */
  deals: CopilotDealRef[];
  query: CopilotQuery;
  retrieval?: Retrieval;
};

const BOOK_LABEL: Record<CommercialModelFilter, string> = {
  all: "All",
  agency_commission: "Agency",
  trader_principal: "Trader",
};

export async function buildGroundedChatMessage(
  userMessage: string,
  opts: {
    focusDealId?: string;
    activeDealIds?: string[];
    bookFilter?: CommercialModelFilter;
  } = {},
): Promise<GroundedChat> {
  const question = userMessage.trim().slice(0, USER_MSG_MAX);
  const query = parseCopilotQuery(question);

  let book;
  try {
    book = await bookWithPayments(await getCopilotBook());
  } catch (err) {
    const reason = err instanceof Error ? err.message : "book unavailable";
    return {
      query,
      deals: [],
      message: `${question}

[Trade Suite context: the live mailbox book could not be loaded (${reason}). Say you can't see the deals right now and suggest refreshing in a minute. Do not invent deal facts.]`,
    };
  }

  // Team people weighted by their mail (src/lib/trade/people): "Radha's POs" → the deals Radha works.
  const people = await getPeopleIndex().catch(() => null);
  const nameOf = new Map((people?.people || []).map((p) => [p.id, p.kind === "shared" ? `${p.name} (shared mailbox)` : p.name]));
  const personId = people && !query.poNumbers.length && !query.dealCodes.length ? personInText(question, people.people) : null;
  const who = personId ? people!.people.find((p) => p.id === personId) : undefined;
  const person: PersonFilter | undefined =
    who && people
      ? {
          id: who.id,
          name: who.name,
          emails: who.emails,
          isActive: who.isActive,
          deals: new Map(
            Object.entries(people.deals).flatMap(([key, rows]) => {
              const r = rows.find((x) => x.personId === who.id);
              return r ? [[key, { role: r.role, score: r.score, lastAt: r.lastAt, lastAction: r.lastAction, latestSender: r.latestSender }] as const] : [];
            }),
          ),
        }
      : undefined;
  const retrieval = retrieveForQuery(book, query, {
    bookFilter: opts.bookFilter,
    focusDealId: opts.focusDealId,
    activeDealIds: opts.activeDealIds,
    person,
  });
  const teamLine = (d: Deal) => {
    const rows = people?.deals[d.mailboxSourceId || d.id];
    if (!rows?.length) return null;
    return rows
      .slice(0, 4)
      .map((r) => `${nameOf.get(r.personId) || r.personId} ${r.role === "owner" ? `owner${r.pinned ? " (set by hand)" : ""}` : "works on it"}${r.latestSender ? ", sent the latest reply" : ""} (last ${r.lastAction === "sent" ? "replied" : "received"} ${r.lastAt.slice(0, 10)})`)
      .join("; ");
  };
  // Deal answers get each deal's latest emails (with links) straight from the mail store.
  if (retrieval.mode === "deal" && retrieval.deals.length) {
    const ledger = await getPaymentLedger(book.deals);
    const head = await Promise.all(
      retrieval.deals.slice(0, 4).map(async (d) => {
        const withMail = await withMailTrail(d);
        const notes = ledger ? paymentLines(ledger, d) : [];
        const extra = await dealExtraNotes(d);
        const team = teamLine(d);
        if (team) extra.unshift(`- Team on this deal (from who replied and who it was sent to): ${team}`);
        const merged = { ...withMail, ...(extra.length ? { extraNotes: extra } : {}) };
        return notes.length ? { ...merged, paymentNotes: notes } : merged;
      }),
    );
    retrieval.deals = [...head, ...retrieval.deals.slice(4)];
  }
  const productBlock = retrieval.mode === "deal" ? "" : await productHistoryBlock(question);
  const block = buildContextBlock(query, retrieval, {
    bookFilterLabel: BOOK_LABEL[query.model || opts.bookFilter || "all"],
    rowNote: person
      ? (d) => {
          const r = person.deals.get(d.mailboxSourceId || d.id);
          if (!r) return null;
          return `${person.name}: ${r.role === "owner" ? "owner" : "works on it"}${r.latestSender ? ", sent the latest reply" : ""} (last ${r.lastAction === "sent" ? "replied" : "received"} ${r.lastAt.slice(0, 10)})`;
        }
      : undefined,
  });

  const shown = retrieval.mode === "deal" ? retrieval.deals : retrieval.deals.slice(0, 6);
  return {
    query,
    retrieval,
    deals: shown.slice(0, 6).map((d) => ({
      id: d.id,
      code: d.code,
      title: d.title.slice(0, 80),
      href: dealHref(d),
    })),
    message: `${question}\n\n${block}${productBlock}`,
  };
}

const PRODUCT_QUESTION = /\b(price|prices|pricing|quote|quotation|vendor|vendors|supplier|suppliers|who (makes|supplies|made)|last (price|cost|rate)|rate for|cost of)\b/i;

/** Vendors and last prices for a product question, from every PO / PI line in the book. */
async function productHistoryBlock(question: string): Promise<string> {
  if (!PRODUCT_QUESTION.test(question)) return "";
  try {
    const found = await searchProductHistory(question, 8);
    const lines = productHistoryLines(found);
    return lines.length ? `\n\nPRODUCT HISTORY (from PO / PI lines in the book; cite the deal codes):\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
  } catch {
    return "";
  }
}

/** Team notes, the agent's next step and the agreed vs actual sailing date for one deal. */
async function dealExtraNotes(d: Deal): Promise<string[]> {
  const out: string[] = [];
  const key = d.mailboxSourceId || d.id;
  try {
    if (mailStoreConfigured()) {
      const store = getMailStore();
      for (const n of await noteTextsFor(store, key, 5)) out.push(`- Team note ${n}`);
      const [rec] = await store.listRecords({ kind: "next_action", dealKey: key, limit: 1 });
      const state = rec?.data as unknown as NextActionState | undefined;
      if (state?.status === "done" && state.result) {
        out.push(`- Suggested next step (agent, read ${state.readAt?.slice(0, 10) || "recently"}): ${state.result.action}${state.result.owner ? ` — ${state.result.owner}` : ""}`);
      }
    }
  } catch {
    /* notes and next step are extras */
  }
  const label = sailingLabel(dealSailing(d));
  if (label) out.push(`- Delivery: ${label}`);
  return out;
}
