"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  hydrateMailboxBook,
  type MailboxHydrateResult,
} from "@/lib/trade/mailboxHydrate";
import { useTradeStore } from "@/lib/trade/store";

function formatUsd(value: number) {
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

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

export function MailboxHydrator() {
  const [meta, setMeta] = useState<MailboxHydrateResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await waitForStoreHydration();
        const next = await hydrateMailboxBook();
        if (!cancelled) setMeta(next);
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
    }
    void load();
    // Slow poll — only useful while PST ingest is running. Fast polls were
    // wiping evidence-loaded source emails every few seconds.
    const poll = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

  if (!meta || meta.error) return null;
  const running = Boolean(meta.progress?.running);
  const target = meta.progress?.target || 0;
  const done = (meta.progress?.completed || 0) + (meta.progress?.failed || 0);

  return (
    <Link
      href="/mailbox"
      className="hidden max-w-xs truncate rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:border-teal-300 hover:text-teal-800 sm:inline-block"
    >
      {running
        ? `Ingest ${done}/${target || "?"} · ${formatUsd(meta.progress?.cost_usd || 0)}`
        : `Mailbox ${meta.count} deals · ${formatUsd(meta.spendUsd)}`}
    </Link>
  );
}
