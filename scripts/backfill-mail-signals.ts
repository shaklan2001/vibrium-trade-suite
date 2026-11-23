/**
 * Compute mail-driven open items (reply owed, approval pending, open issue…) for every deal with mail in
 * a connected mailbox, and save the index the app reads. New mail refreshes its deals during sync.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-mail-signals.ts
 */
import { SIGNAL_GRACE_DAYS, signalAgeDays } from "../src/lib/mail/mailSignals";
import { getSignalIndex, refreshSignals } from "../src/lib/mail/signalStore";
import { getMailStore } from "../src/lib/mail/store";

async function main() {
  const store = getMailStore();
  const keys = await store.liveDealKeys();
  console.log(`${keys.length} deals with live mail`);
  for (let i = 0; i < keys.length; i += 25) {
    await refreshSignals(keys.slice(i, i + 25), store);
    console.log(`  ${Math.min(i + 25, keys.length)}/${keys.length}`);
  }
  const index = await getSignalIndex();
  const today = new Date().toISOString().slice(0, 10);
  const all = Object.values(index.deals).flatMap((d) => d.items);
  const due = all.filter((s) => signalAgeDays(s, today) >= SIGNAL_GRACE_DAYS[s.kind]);
  const count = (list: typeof all) => list.reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] || 0) + 1), m), {});
  console.log({ dealsWithOpenItems: Object.keys(index.deals).length, openItems: count(all), warningsNow: count(due), dealsWarned: new Set(Object.entries(index.deals).filter(([, d]) => d.items.some((s) => signalAgeDays(s, today) >= SIGNAL_GRACE_DAYS[s.kind])).map(([k]) => k)).size });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
