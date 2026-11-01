"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  hydrateMailboxBook,
  type MailboxHydrateResult,
} from "@/lib/trade/mailboxHydrate";
import { useTradeStore } from "@/lib/trade/store";

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
  const status = useTradeStore((s) => s.mailboxBookStatus);
  const dealCount = useTradeStore(
    (s) => s.deals.filter((d) => d.mailboxIngest).length,
  );

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
    // Slow poll — only useful while PST ingest is running.
    const poll = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

  if (meta?.error && status === "error") return null;

  const running = Boolean(meta?.progress?.running);
  const target = meta?.progress?.target || 0;
  const done =
    (meta?.progress?.completed || 0) + (meta?.progress?.failed || 0);
  const count = meta?.count ?? dealCount;

  let label = "Loading mailbox…";
  if (status === "loading" && !count) label = "Loading mailbox…";
  else if (running) label = `Ingest ${done}/${target || "?"}`;
  else if (status === "ready" || count > 0) label = `Mailbox ${count} deals`;

  return (
    <Link
      href="/mailbox"
      className="hidden max-w-xs truncate rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition hover:border-teal-300 hover:text-teal-800 sm:inline-block"
    >
      {status === "loading" && !running ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 animate-spin rounded-full border border-zinc-300 border-t-teal-700"
            aria-hidden
          />
          {label}
        </span>
      ) : (
        label
      )}
    </Link>
  );
}
