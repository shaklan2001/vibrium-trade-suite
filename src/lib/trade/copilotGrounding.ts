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
import { parseCopilotQuery, type CopilotQuery } from "@/lib/trade/copilot/query";
import { retrieveForQuery, type Retrieval } from "@/lib/trade/copilot/retrieve";

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
    book = await getCopilotBook();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "book unavailable";
    return {
      query,
      deals: [],
      message: `${question}

[Trade Suite context: the live mailbox book could not be loaded (${reason}). Say you can't see the deals right now and suggest refreshing in a minute. Do not invent deal facts.]`,
    };
  }

  const retrieval = retrieveForQuery(book, query, {
    bookFilter: opts.bookFilter,
    focusDealId: opts.focusDealId,
    activeDealIds: opts.activeDealIds,
  });
  const block = buildContextBlock(query, retrieval, {
    bookFilterLabel: BOOK_LABEL[query.model || opts.bookFilter || "all"],
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
    message: `${question}\n\n${block}`,
  };
}
