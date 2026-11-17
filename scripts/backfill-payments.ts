/**
 * Read every payment email already in the connected mailboxes into the payment ledger.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-payments.ts            # queue + read into mail_payments
 *   npx tsx --env-file=.env.local scripts/backfill-payments.ts --dry      # read into data/payments/entries.json only
 *   npx tsx --env-file=.env.local scripts/backfill-payments.ts --queue    # only queue; the mail sync reads them
 *
 * New mail is handled by the sync itself; this is for mail synced before the ledger existed.
 * Rows already read (done / not_payment) are skipped, so it can be re-run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finishPaymentRead, paymentRowFor, startPaymentRead, type PaymentRow } from "../src/lib/mail/paymentJobs";
import { getMailStore } from "../src/lib/mail/store";
import type { InboxMessageRow } from "../src/lib/mail/types";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const QUEUE_ONLY = args.includes("--queue");
const CONCURRENCY = Number(args[args.indexOf("--concurrency") + 1]) || 4;
const FILE = path.join(process.cwd(), "data", "payments", "entries.json");

async function main() {
  const store = getMailStore();
  const conns = (await store.listConnections()).filter((c) => c.status === "active");
  const ids = conns.map((c) => c.id);
  const mailboxOf = new Map(conns.map((c) => [c.id, c.email]));

  const keys: string[] = [];
  let before: { at: string; key: string } | null = null;
  for (;;) {
    const page = await store.inboxPage({ connectionIds: ids, limit: 100, before });
    keys.push(...page.threads.map((t) => t.thread_key));
    const last = page.threads[page.threads.length - 1];
    if (!page.has_more || !last) break;
    before = { at: last.last_at, key: last.thread_key };
  }
  const found = new Map<string, PaymentRow>();
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < keys.length) {
        const threadKey = keys[next++]!;
        const rows: InboxMessageRow[] = await store.threadMessages({ connectionIds: ids, threadKey, limit: 100 }).catch(() => []);
        for (const r of rows) {
          const row = paymentRowFor(r, mailboxOf.get(r.connection_id) || r.connection_id);
          if (row && !found.has(row.id)) found.set(row.id, row);
        }
      }
    }),
  );
  console.log(`${keys.length} conversations · ${found.size} payment candidates`);

  // Skip what is already read.
  const known = new Map<string, PaymentRow>();
  if (DRY) {
    for (const r of (await readFile(FILE, "utf8").then(JSON.parse).catch(() => [])) as PaymentRow[]) known.set(r.id, r);
  } else {
    for (let i = 0, list = [...found.keys()]; i < list.length; i += 500) {
      for (const r of await store.listPayments({ ids: list.slice(i, i + 500), limit: 500 })) known.set(r.id, r);
    }
  }
  const todo = [...found.values()].filter((r) => !["done", "not_payment"].includes(known.get(r.id)?.status || ""));
  console.log(`${found.size - todo.length} already read · ${todo.length} to read`);

  if (!DRY) await store.upsertPayments(todo);
  if (QUEUE_ONLY) return;

  const results = new Map(known);
  const save = async () => {
    if (DRY) {
      await mkdir(path.dirname(FILE), { recursive: true });
      await writeFile(FILE, JSON.stringify([...results.values()], null, 1));
    }
  };
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < todo.length) {
        let row = todo[i++]!;
        try {
          // Up to two passes: with the attachment, then text only if the attachment can't be read.
          for (let pass = 0; pass < 2 && (row.status === "pending" || row.status === "failed"); pass++) {
            row = await startPaymentRead(row);
            for (;;) {
              await new Promise((r) => setTimeout(r, 4000));
              const fin = await finishPaymentRead(row);
              if (fin) {
                row = fin;
                break;
              }
            }
          }
        } catch (err) {
          row = { ...row, status: "failed", error: String(err).slice(0, 300), updatedAt: new Date().toISOString() };
        }
        results.set(row.id, row);
        if (!DRY) await store.upsertPayments([row]);
        done++;
        console.log(
          `  [${done}/${todo.length}] ${row.status} ${row.kind || ""} ${row.amount ?? ""} ${row.currency || ""} POs ${row.allocations.map((a) => a.po).filter(Boolean).join(",") || "-"} · ${row.subject.slice(0, 60)}`,
        );
        if (done % 10 === 0) await save();
      }
    }),
  );
  await save();
  const all = [...results.values()];
  const count = (s: string) => all.filter((r) => r.status === s).length;
  console.log(`\nRead ${done}. Ledger: ${count("done")} payments · ${count("not_payment")} not payments · ${count("failed")} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
