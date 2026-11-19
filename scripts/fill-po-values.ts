/**
 * Fill PO values for the orders that have payment emails, so payments can be set against what is owed.
 *
 *   npx tsx --env-file=.env.local scripts/fill-po-values.ts            # plan only: files to read, cost, gaps
 *   npx tsx --env-file=.env.local scripts/fill-po-values.ts --run      # read them (PI / PO extractor per file), wait, report
 *
 * Uses the existing per-document reader (src/lib/trade/documentExtraction.ts): every PI / PO /
 * invoice attachment on those deals gets its own extractor run; results land in deal_documents
 * and the book adds them up per side (deal.po = buyer side, deal.pi = factory side).
 * Writes data/payments/po-fill.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMailStore } from "../src/lib/mail/store";
import { getCopilotBook } from "../src/lib/trade/copilot/book";
import { finalizeDealDocuments, planDealDocuments, startDealDocuments } from "../src/lib/trade/documentExtraction";
import { buildPaymentLedger } from "../src/lib/trade/paymentLedger";

const RUN = process.argv.includes("--run");

async function main() {
  const book = await getCopilotBook();
  const entries = await getMailStore().listPayments({ status: "done", limit: 5000 });
  const ledger = buildPaymentLedger(entries, book.deals);
  const byId = new Map(book.deals.map((d) => [d.id, d]));
  const keys = new Set<string>();
  for (const o of ledger.orders) {
    const d = o.dealId ? byId.get(o.dealId) : undefined;
    if (d?.mailboxSourceId) keys.add(d.mailboxSourceId);
  }
  for (const e of entries) if (e.dealKey) keys.add(e.dealKey);
  const dealIds = [...keys];
  const before = ledger.orders.filter((o) => o.poValue).length;
  console.log(`${ledger.orders.length} orders with payment emails (${before} with a PO value) · ${dealIds.length} deals`);

  const plan = { toRead: [] as Awaited<ReturnType<typeof planDealDocuments>>["toRead"], skipped: [] as Awaited<ReturnType<typeof planDealDocuments>>["skipped"], alreadyRead: 0, deals: 0 };
  for (let i = 0; i < dealIds.length; i += 20) {
    const p = await planDealDocuments(dealIds.slice(i, i + 20));
    plan.toRead.push(...p.toRead);
    plan.skipped.push(...p.skipped);
    plan.alreadyRead += p.alreadyRead;
    plan.deals += p.deals;
  }
  const reasons = plan.skipped.reduce<Record<string, number>>((a, s) => ((a[s.reason.replace(/^\.\w+/, ".ext")] = (a[s.reason.replace(/^\.\w+/, ".ext")] || 0) + 1), a), {});
  console.log(`Files to read: ${plan.toRead.length} (≈ USD ${(plan.toRead.length * 0.05).toFixed(2)}) · already read ${plan.alreadyRead} · skipped ${plan.skipped.length}`, reasons);
  console.log(`  by extractor: ${JSON.stringify(plan.toRead.reduce<Record<string, number>>((a, d) => ((a[d.slot] = (a[d.slot] || 0) + 1), a), {}))}`);
  for (const d of plan.toRead.slice(0, 12)) console.log(`  ${d.slot} · ${d.dealId.slice(0, 40)} · ${d.name}`);

  const out: Record<string, unknown> = { plan: { deals: plan.deals, toRead: plan.toRead.length, alreadyRead: plan.alreadyRead, skipped: reasons }, ordersBefore: { total: ledger.orders.length, withPoValue: before } };
  if (RUN && plan.toRead.length) {
    const started = await startDealDocuments(plan.toRead, { deadline: Date.now() + 30 * 60_000 });
    console.log(`Started ${started.started} reads (${started.failed} failed to start). Waiting…`);
    for (let round = 0; round < 60; round++) {
      await new Promise((r) => setTimeout(r, 15_000));
      const f = await finalizeDealDocuments({ deadline: Date.now() + 60_000 });
      console.log(`  completed ${f.completed} · failed ${f.failed} · still running ${f.waiting}`);
      if (!f.waiting) break;
    }
    out.started = started;
  }
  await mkdir(path.join(process.cwd(), "data", "payments"), { recursive: true });
  await writeFile(path.join(process.cwd(), "data", "payments", "po-fill.json"), JSON.stringify(out, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
