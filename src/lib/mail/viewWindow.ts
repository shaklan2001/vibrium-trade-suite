import { MAIL_LIMITS } from "./config";

/**
 * What the shared inbox shows. Nothing is deleted from the store or the mailbox;
 * this only decides which conversations are listed.
 *
 *   last activity  ≤ 12 months ago  → listed (the one-year view)
 *   no activity for 6 months      → "dead", not listed (mail threads and deals alike)
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function viewCutoffs(now = Date.now()) {
  return {
    /** Older than this is out of the one-year view. */
    yearAgo: now - MAIL_LIMITS.viewDays * DAY_MS,
    /** A conversation quiet since before this is dead. */
    deadBefore: now - MAIL_LIMITS.deadDays * DAY_MS,
  };
}

export function isDead(lastAt: string | number | Date, now = Date.now()) {
  const t = new Date(lastAt).getTime();
  return Number.isFinite(t) && t < viewCutoffs(now).deadBefore;
}

/** A processed-deal row is live while its last mail (or, failing that, its processing) is under 6 months old. */
export function isLiveDealRow(row: { date_end?: string | null; processed_at?: string | null }, now = Date.now()) {
  const at = row.date_end || row.processed_at;
  return !at || !isDead(at, now);
}

/**
 * Keep threads inside the year. Threads arrive newest first, so once one falls
 * outside the year the rest do too and paging can stop (`done`).
 */
export function withinYear<T extends { last_at: string }>(threads: T[], now = Date.now()) {
  const { yearAgo } = viewCutoffs(now);
  const kept = threads.filter((t) => new Date(t.last_at).getTime() >= yearAgo);
  return { kept, done: kept.length < threads.length };
}
