/**
 * Mailbox sync windows: a mailbox with more mail than one listing holds is read in full, newest first,
 * and mail that arrives meanwhile is picked up.
 *   npx tsx scripts/test-sync-window.ts
 */
import assert from "node:assert/strict";
import { beforeInclusive, keepNewest, listForRun, nextCursor, pendingGap, type Listed, type SyncCursor } from "../src/lib/mail/syncWindow";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-25T06:00:00Z");

/** A fake mailbox: message i arrived i hours after `start`; search works on whole days, like IMAP. */
function mailbox(n: number, start: number) {
  const msgs = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, date: new Date(start + i * 3_600_000) }));
  const day = (d: Date) => Math.floor(d.getTime() / DAY);
  const list = async (since: Date, cap: number, before?: Date): Promise<Listed> => {
    const hits = msgs.filter((m) => day(m.date) >= day(since) && (!before || day(m.date) < day(beforeInclusive(before))));
    const { kept, truncatedAt } = keepNewest(hits, cap);
    return { refs: kept.map((m) => ({ id: m.id })), truncatedAt };
  };
  return { msgs, list };
}

/** One sync run, the same steps as syncConnection: list, take a batch, update the cursor. */
async function run(box: ReturnType<typeof mailbox>, store: Set<string>, cursor: SyncCursor, at: number, cap: number, batchSize: number, floorDays: number) {
  const listing = await listForRun({
    cursor,
    floorMs: at - floorDays * DAY,
    overlapMs: 2 * 3_600_000,
    cap,
    list: box.list,
    known: async (ids) => new Set(ids.filter((i) => store.has(i))),
  });
  const fresh = [...listing.fresh].reverse(); // newest first
  const batch = fresh.slice(0, batchSize);
  for (const m of batch) store.add(m.id);
  const remaining = fresh.length - batch.length;
  const next = nextCursor(cursor, {
    startedAt: new Date(at),
    recentDone: listing.usedGap || remaining === 0,
    usedGap: listing.usedGap,
    gapDone: listing.usedGap && remaining === 0,
    truncatedAt: listing.truncatedAt,
    listedFrom: listing.listedFrom,
  });
  return { next, listing, batch };
}

async function main() {
  await test("keepNewest keeps the newest and says where it cut", () => {
    const items = [1, 2, 3, 4, 5].map((i) => ({ date: new Date(i * DAY) }));
    const r = keepNewest(items, 2);
    assert.equal(r.kept.length, 2);
    assert.equal(r.truncatedAt?.getTime(), 4 * DAY);
    assert.equal(keepNewest(items, 9).truncatedAt, null);
  });

  await test("a mailbox over the cap is read in full (12,000 messages, cap 5,000, 150 per run)", async () => {
    const box = mailbox(12_000, NOW - 500 * 3_600_000);
    const store = new Set<string>();
    let cursor: SyncCursor = {};
    let runs = 0;
    while (runs < 400) {
      const r = await run(box, store, cursor, NOW + runs * 300_000, 5000, 150, 365);
      cursor = r.next;
      runs += 1;
      if (store.size >= 12_000 && !pendingGap(cursor)) break;
    }
    assert.equal(store.size, 12_000, `read ${store.size} of 12000 in ${runs} runs`);
    assert.equal(pendingGap(cursor), null);
    assert.ok(runs <= 120, `took ${runs} runs`);
  });

  await test("the newest mail is read first, so a big mailbox shows today's mail at once", async () => {
    const box = mailbox(12_000, NOW - 500 * 3_600_000);
    const store = new Set<string>();
    const r = await run(box, store, {}, NOW, 5000, 150, 365);
    assert.ok(r.batch.some((m) => m.id === "m11999"), "the newest message is in the first batch");
    assert.ok(!store.has("m0"));
  });

  await test("mail that arrives while the older part is still being read is picked up", async () => {
    const box = mailbox(12_000, NOW - 500 * 3_600_000);
    const store = new Set<string>();
    let cursor: SyncCursor = {};
    for (let i = 0; i < 90; i += 1) cursor = (await run(box, store, cursor, NOW + i * 300_000, 5000, 150, 365)).next;
    const late = { id: "late1", date: new Date(NOW + 91 * 300_000 - 60_000) };
    box.msgs.push(late);
    for (let i = 90; i < 400 && (store.size < 12_001 || pendingGap(cursor)); i += 1) {
      cursor = (await run(box, store, cursor, NOW + i * 300_000, 5000, 150, 365)).next;
    }
    assert.ok(store.has("late1"));
    assert.equal(store.size, 12_001);
  });

  await test("a normal mailbox behaves as before: one listing, no gap, synced_through moves on", async () => {
    const box = mailbox(300, NOW - 300 * 3_600_000);
    const store = new Set<string>();
    let cursor: SyncCursor = {};
    cursor = (await run(box, store, cursor, NOW, 5000, 150, 365)).next;
    assert.equal(pendingGap(cursor), null);
    assert.equal(cursor.synced_through, undefined, "150 of 300 read: not caught up yet");
    cursor = (await run(box, store, cursor, NOW + 300_000, 5000, 150, 365)).next;
    assert.equal(cursor.synced_through, new Date(NOW + 300_000).toISOString());
    assert.equal(store.size, 300);
  });

  await test("lowering the backfill days clips an old gap instead of reading past the floor", async () => {
    const box = mailbox(12_000, NOW - 500 * 3_600_000);
    const store = new Set<string>();
    let cursor: SyncCursor = {};
    for (let i = 0; i < 60; i += 1) cursor = (await run(box, store, cursor, NOW + i * 300_000, 5000, 150, 365)).next;
    const r = await run(box, store, cursor, NOW + 61 * 300_000, 5000, 150, 3);
    assert.ok(r.listing.listedFrom.getTime() >= NOW - 3 * DAY - DAY);
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
