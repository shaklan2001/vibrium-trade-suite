/**
 * IndexedDB snapshot of the last mailbox book, so a revisit renders instantly
 * while a background refresh runs. localStorage is too small (~5 MB) for it.
 *
 * Every call is best-effort: private windows, blocked storage or a schema bump
 * just mean "no cache" and the app falls back to the network.
 */

import type { ProcessedDealRow } from "./processedDealMapper";

const DB_NAME = "vibrium-trade-cache";
const STORE = "kv";
const KEY = "mailbox-book";
/** Bump when the cached row shape or mapper inputs change. */
const VERSION = 1;
/** Older snapshots are ignored rather than shown. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type BookSnapshot = {
  version: number;
  savedAt: number;
  signature: string;
  rows: ProcessedDealRow[];
  liveIds: string[];
  failedExtracts: number | null;
};

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readBookSnapshot(): Promise<BookSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const snap = req.result as BookSnapshot | undefined;
        db.close();
        if (
          !snap ||
          snap.version !== VERSION ||
          !Array.isArray(snap.rows) ||
          Date.now() - snap.savedAt > MAX_AGE_MS
        ) {
          resolve(null);
          return;
        }
        resolve(snap);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function writeBookSnapshot(
  snap: Omit<BookSnapshot, "version" | "savedAt">,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(
        { ...snap, version: VERSION, savedAt: Date.now() } satisfies BookSnapshot,
        KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

/** Drop the snapshot (e.g. on sign-out). */
export async function clearBookSnapshot(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
