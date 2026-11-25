import { MAIL_LIMITS } from "./config";

/**
 * What the shared inbox shows. Nothing is deleted from the store or the mailbox;
 * this only decides which conversations are listed.
 *
 *   last activity  ≤ 12 months ago  → listed (the one-year view)
 *   no deal + no activity for 6 months → "dead", not listed
 *   attached to a deal            → kept for the full year, even when quiet
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function viewCutoffs(now = Date.now()) {
  return {
    /** Older than this is out of the one-year view. */
    yearAgo: now - MAIL_LIMITS.viewDays * DAY_MS,
    /** A conversation quiet since before this, with no deal, is dead. */
    deadBefore: now - MAIL_LIMITS.deadDays * DAY_MS,
  };
}

export function isDead(lastAt: string | number | Date, hasDeal: boolean, now = Date.now()) {
  if (hasDeal) return false;
  return new Date(lastAt).getTime() < viewCutoffs(now).deadBefore;
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
