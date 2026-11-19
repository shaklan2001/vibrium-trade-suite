"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  hydrateMailboxBook,
  type MailboxHydrateResult,
} from "@/lib/trade/mailboxHydrate";
import { useTradeStore } from "@/lib/trade/store";

/** Background refresh cadence while the tab is visible. */
const REFRESH_MS = 3 * 60_000;
/** Faster while a PST ingest is running, to show its progress. */
const INGEST_REFRESH_MS = 45_000;

function waitForStoreHydration() {
  return new Promise<void>((resolve) => {
    if (useTradeStore.persist.hasHydrated()) {
      resolve();
      return;
    }
    const unsub = useTradeStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

/**
 * Owns the mailbox book lifecycle: loads it once, then refreshes quietly in
 * the background (next refresh is scheduled only after the previous one
 * finishes, and never while the tab is hidden). Renders the header chip.
 */
export function MailboxHydrator() {
  const [meta, setMeta] = useState<MailboxHydrateResult | null>(null);
  const status = useTradeStore((s) => s.mailboxBookStatus);
  const refreshing = useTradeStore((s) => s.mailboxBookRefreshing);
  const progress = useTradeStore((s) => s.mailboxBookProgress);
  const dealCount = useTradeStore(
    (s) => s.deals.filter((d) => d.mailboxIngest).length,
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let lastRun = 0;
    let ingestRunning = false;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void tick(),
        ingestRunning ? INGEST_REFRESH_MS : REFRESH_MS,
      );
    };

    async function tick() {
      if (cancelled) return;
      // Hidden tab: don't refresh; visibilitychange picks it up on return.
      if (document.visibilityState !== "visible" && lastRun > 0) return;
      try {
        await waitForStoreHydration();
        lastRun = Date.now();
        const next = await hydrateMailboxBook();
        if (cancelled) return;
        ingestRunning = Boolean(next.progress?.running);
        setMeta(next);
      } catch (err) {
        if (!cancelled) {
          setMeta({
            count: 0,
            spendUsd: 0,
            progress: null,
            error: err instanceof Error ? err.message : "Mailbox load failed",
          });
        }
      }
      if (!cancelled) schedule();
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const due = ingestRunning ? INGEST_REFRESH_MS : REFRESH_MS;
      if (Date.now() - lastRun >= due) void tick();
      else schedule();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (meta?.error && status === "error") return null;

  const ingest = meta?.progress?.running ? meta.progress : null;
  const count = dealCount || meta?.count || 0;

  let label: string;
  let busy = false;
  if (progress) {
    label = `Loading ${progress.loaded.toLocaleString()}/${progress.total.toLocaleString()}`;
    busy = true;
  } else if (status === "idle" || (status === "loading" && !count)) {
    label = "Loading mailbox…";
    busy = true;
  } else if (ingest) {
    const done = (ingest.completed || 0) + (ingest.failed || 0);
    label = `Ingest ${done}/${ingest.target || "?"}`;
  } else {
    label = `Mailbox ${count.toLocaleString()} deals`;
    busy = refreshing;
  }

  return (
    <Link
      href="/mailbox"
      title={refreshing ? "Refreshing in the background" : undefined}
      className="hidden max-w-xs truncate rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition hover:border-teal-300 hover:text-teal-800 sm:inline-block"
    >
      <span className="inline-flex items-center gap-1.5">
        {busy ? (
          <span
            className="h-2.5 w-2.5 animate-spin rounded-full border border-zinc-300 border-t-teal-700"
            aria-hidden
          />
        ) : null}
        {label}
      </span>
    </Link>
  );
}
