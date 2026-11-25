/**
 * Mailbox sync windows, so a mailbox with more mail than one listing can hold is still read in full.
 *
 * One listing holds at most `cap` messages. When a window holds more, the NEWEST `cap` are kept (the
 * newest mail matters most) and the older part is remembered as a gap: mail between `gap_from` and
 * `gap_before` that has not been listed yet. Later runs list the gap in the same way, newest part
 * first, until the gap is closed. Nothing is skipped and nothing is read twice (known ids are
 * filtered by the caller). Pure.
 */

export type SyncCursor = {
  synced_through?: string;
  /** Older mail still to list: from this date (oldest) … */
  gap_from?: string;
  /** … up to (not including) this date. */
  gap_before?: string;
};

export type Listed = {
  refs: { id: string }[];
  /** When the window held more than the cap: the date of the oldest message kept. Null when everything was listed. */
  truncatedAt: Date | null;
};

/** Keep the newest `room` of items sorted oldest-first; report where the cut fell. */
export function keepNewest<T extends { date: Date }>(items: T[], room: number): { kept: T[]; truncatedAt: Date | null } {
  if (items.length <= room) return { kept: items, truncatedAt: null };
  const kept = items.slice(items.length - Math.max(room, 0));
  return { kept, truncatedAt: kept[0]?.date ?? null };
}

/** Across folders the uncovered part is the union: older than the NEWEST cut. */
export function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * New cursor after a run.
 *   recentDone    the recent window (since the last sync) was fully read, so synced_through moves on
 *   usedGap       this run listed the gap window instead of the recent one
 *   gapDone       every message of the listed window is now known
 *   truncatedAt   cut point of the listing used this run (null = the listing was complete)
 *   listedFrom    the oldest date the listing covered
 */
export function nextCursor(
  prev: SyncCursor,
  run: { startedAt: Date; recentDone: boolean; usedGap: boolean; gapDone: boolean; truncatedAt: Date | null; listedFrom: Date },
): SyncCursor {
  const out: SyncCursor = { ...prev };
  if (run.usedGap) {
    if (run.gapDone) {
      if (run.truncatedAt) out.gap_before = run.truncatedAt.toISOString();
      else {
        delete out.gap_from;
        delete out.gap_before;
      }
    }
  } else if (run.truncatedAt) {
    // The recent window held more than one listing: remember the older part that was cut off.
    const from = prev.gap_from ? new Date(Math.min(Date.parse(prev.gap_from), run.listedFrom.getTime())) : run.listedFrom;
    const before = prev.gap_before ? laterOf(new Date(prev.gap_before), run.truncatedAt)! : run.truncatedAt;
    out.gap_from = from.toISOString();
    out.gap_before = before.toISOString();
  }
  if (run.recentDone) out.synced_through = run.startedAt.toISOString();
  return out;
}

/** The older window still to list, or null. */
export function pendingGap(cursor: SyncCursor): { from: Date; before: Date } | null {
  if (!cursor.gap_from || !cursor.gap_before) return null;
  const from = new Date(cursor.gap_from);
  const before = new Date(cursor.gap_before);
  return from.getTime() < before.getTime() ? { from, before } : null;
}

const DAY_MS = 86_400_000;

export type RunListing = {
  /** Messages not stored yet, oldest first. */
  fresh: { id: string }[];
  /** True when the older gap was listed instead of the recent window. */
  usedGap: boolean;
  listed: number;
  truncatedAt: Date | null;
  listedFrom: Date;
};

/**
 * What to read in this run: the recent window first; once it has nothing new, the older gap left by a
 * mailbox bigger than one listing. `list` returns messages oldest first; `known` says which ids are stored.
 */
export async function listForRun(opts: {
  cursor: SyncCursor;
  floorMs: number;
  overlapMs: number;
  cap: number;
  list: (since: Date, cap: number, before?: Date) => Promise<Listed>;
  known: (ids: string[]) => Promise<Set<string>>;
}): Promise<RunListing> {
  const { cursor, floorMs, overlapMs, cap } = opts;
  const since = new Date(cursor.synced_through ? Math.max(floorMs, Date.parse(cursor.synced_through) - overlapMs) : floorMs);
  const recent = await opts.list(since, cap);
  let known = await opts.known(recent.refs.map((r) => r.id));
  let fresh = recent.refs.filter((r) => !known.has(r.id));
  let out: RunListing = { fresh, usedGap: false, listed: recent.refs.length, truncatedAt: recent.truncatedAt, listedFrom: since };
  const gap = pendingGap(cursor);
  if (!fresh.length && gap) {
    // The window may start before the floor (the backfill days were lowered): clip it.
    const from = new Date(Math.max(gap.from.getTime(), floorMs));
    if (from.getTime() < gap.before.getTime()) {
      const older = await opts.list(from, cap, gap.before);
      known = await opts.known(older.refs.map((r) => r.id));
      fresh = older.refs.filter((r) => !known.has(r.id));
      out = { fresh, usedGap: true, listed: older.refs.length, truncatedAt: older.truncatedAt, listedFrom: from };
    } else {
      out = { ...out, usedGap: true, listed: 0, truncatedAt: null, listedFrom: from, fresh: [] };
    }
  }
  return out;
}

/** IMAP BEFORE ignores the time of day and excludes the named day, so ask for the day after the cut. */
export function beforeInclusive(d: Date): Date {
  return new Date(d.getTime() + DAY_MS);
}
