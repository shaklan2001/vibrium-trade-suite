/**
 * Copilot grounding eval against the live book (no LLM call by default).
 *
 *   npx tsx --env-file=.env.local scripts/eval-copilot.ts           # retrieval checks
 *   npx tsx --env-file=.env.local scripts/eval-copilot.ts --show 3  # print case 3's context
 *   npx tsx --env-file=.env.local scripts/eval-copilot.ts --live    # also ask the bot via localhost:3000
 *
 * Each case checks what the Copilot would hand the model: the right deals,
 * the right mode, and true totals. Answers are only as good as this context.
 */
import { buildGroundedChatMessage } from "../src/lib/trade/copilotGrounding";
import { getCopilotBook } from "../src/lib/trade/copilot/book";
import { shortDealKey } from "../src/lib/trade/dealLink";
import type { Deal } from "../src/types/trade";

type Case = {
  q: string;
  expectMode?: string;
  /** Every one of these deal codes must be among the deals handed to the model. */
  expectCodes?: string[];
  /** Context must contain each of these strings. */
  expectText?: (book: Deal[]) => string[];
  focus?: (book: Deal[]) => string | undefined;
  active?: (book: Deal[]) => string[];
  /** Custom check over the handed deals. */
  check?: (deals: Deal[], book: Deal[]) => string | null;
};

const byCode = (book: Deal[], code: string) => book.find((d) => d.code === code);
const count = (book: Deal[], f: (d: Deal) => boolean) => book.filter(f).length.toLocaleString("en-US");

const CASES: Case[] = [
  { q: "Summarize PO 15269", expectMode: "deal", expectCodes: ["PO-15269"] },
  { q: "What is the status of PO# 14837?", expectMode: "deal", expectCodes: ["PO-14837"] },
  { q: "open 14945", expectMode: "deal", expectCodes: ["PO-14945"] },
  { q: "tell me about S14747", expectMode: "deal", expectCodes: ["PO-S14747"] },
  {
    q: "How many deals are in booking stage?",
    expectMode: "count",
    expectText: (b) => [`Booking ${count(b, (d) => d.stage === "booking")}`],
  },
  {
    q: "Give me a summary of the Swastik deals",
    expectMode: "list",
    check: (deals) =>
      deals.length && deals.every((d) => /swastik/i.test(JSON.stringify(d.parties) + d.searchText + d.title))
        ? null
        : "expected only Swastik deals",
  },
  {
    q: "Show kalpana deals",
    check: (deals) =>
      deals.length && deals.every((d) => /kalpana/i.test(`${d.searchText} ${JSON.stringify(d.parties)}`))
        ? null
        : "expected deals involving kalpana",
  },
  { q: "Which deals have overdue payments?", expectMode: "list" },
  { q: "What needs my attention today?", expectMode: "attention" },
  {
    q: "what is its payment term?",
    expectMode: "deal",
    expectCodes: ["PO-15269"],
    active: (b) => [byCode(b, "PO-15269")?.id || ""],
  },
  {
    q: "summarize this deal",
    expectMode: "deal",
    expectCodes: ["PO-14837"],
    focus: (b) => byCode(b, "PO-14837")?.id,
  },
  {
    q: "summarize this deal",
    expectMode: "deal",
    expectCodes: ["PO-15269"],
    // Page opened through a Copilot short link.
    focus: (b) => {
      const d = byCode(b, "PO-15269");
      return d ? shortDealKey(d) : undefined;
    },
  },
  { q: "Summarize PO 99999999", expectMode: "not_found" },
  {
    q: "status of PO 14684",
    expectMode: "deal",
    check: (deals) => (deals.length >= 2 ? null : "expected the split shipments 14684A/B/C"),
  },
  { q: "How do I connect a new mailbox?", expectMode: "product" },
  { q: "How many deals are in the trader book?", expectMode: "count" },
  {
    q: "which SNSPL teammate is on this thread?",
    expectMode: "deal",
    expectCodes: ["PO-14837"],
    active: (b) => [byCode(b, "PO-14837")?.id || ""],
  },
  {
    q: "which of them are overdue?",
    expectMode: "deal",
    expectCodes: ["PO-15269"],
    active: (b) => [byCode(b, "PO-15269")?.id || "", byCode(b, "PO-14837")?.id || ""],
    check: (deals) => (deals.length === 1 ? null : "expected only the overdue one of the two"),
  },
  {
    q: "show deals that are overdue",
    expectMode: "list",
    active: (b) => [byCode(b, "PO-14837")?.id || ""],
  },
  {
    q: "who is the forwarder?",
    expectMode: "deal",
    expectText: () => ["skyline-freight.com"],
    active: (b) => [byCode(b, "PO-14837")?.id || ""],
  },
];

async function main() {
  const args = process.argv.slice(2);
  const show = args.includes("--show") ? Number(args[args.indexOf("--show") + 1]) : -1;
  const live = args.includes("--live");

  const t0 = Date.now();
  const book = await getCopilotBook();
  console.log(`book: ${book.deals.length} deals loaded in ${Date.now() - t0}ms\n`);

  let pass = 0;
  for (const [i, c] of CASES.entries()) {
    const g = await buildGroundedChatMessage(c.q, {
      focusDealId: c.focus?.(book.deals),
      activeDealIds: c.active?.(book.deals),
    });
    const r = g.retrieval!;
    const handed = r.deals;
    const problems: string[] = [];
    if (c.expectMode && r.mode !== c.expectMode) problems.push(`mode ${r.mode} ≠ ${c.expectMode}`);
    for (const code of c.expectCodes || []) {
      if (!handed.some((d) => d.code === code)) problems.push(`missing ${code}`);
    }
    for (const t of c.expectText?.(book.deals) || []) {
      if (!g.message.includes(t)) problems.push(`context lacks "${t}"`);
    }
    const custom = c.check?.(handed, book.deals);
    if (custom) problems.push(custom);
    if (g.message.length > 14_000) problems.push(`context too long (${g.message.length})`);

    const ok = problems.length === 0;
    if (ok) pass += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"} [${i}] ${c.q}\n     mode=${r.mode} matched=${r.matchedTotal} by=${r.matchedBy.join("; ") || "-"} deals=${handed
        .slice(0, 5)
        .map((d) => d.code)
        .join(", ")} ctx=${g.message.length}ch${problems.length ? `\n     ✗ ${problems.join(" · ")}` : ""}`,
    );
    if (i === show) console.log(`\n----- context [${i}] -----\n${g.message}\n-----\n`);

    if (live) {
      const contactId = `trade-eval-${Date.now()}-${i}`;
      await fetch("http://localhost:3000/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const res = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          message: c.q,
          focusDealId: c.focus?.(book.deals),
          activeDealIds: c.active?.(book.deals),
        }),
      });
      console.log(`     ↳ ${(await res.text()).replace(/\s+/g, " ").slice(0, 400)}\n`);
    }
  }
  console.log(`\n${pass}/${CASES.length} passed`);
  process.exit(pass === CASES.length ? 0 : 1);
}

void main();
