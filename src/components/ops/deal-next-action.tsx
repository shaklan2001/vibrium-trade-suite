"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { shortDealKey } from "@/lib/trade/dealLink";
import { dealSailing, sailingLabel } from "@/lib/trade/sailing";
import type { Deal } from "@/types/trade";

type Next = { action: string; owner: string | null; to: string | null; due: string | null; basedOn: string[]; readAt?: string };

/** The agent's next step for the deal (from all threads) and the agreed vs actual sailing date. */
export function DealNextAction({ deal }: { deal: Deal }) {
  const [next, setNext] = useState<Next | null>(null);
  const key = deal.mailboxSourceId || deal.id;
  useEffect(() => {
    let cancelled = false;
    fetch("/api/mail/next-actions", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { actions?: Record<string, Next> }) => !cancelled && setNext(j.actions?.[key] || null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);
  const sailing = sailingLabel(dealSailing(deal));
  if (!next && !sailing) return null;
  return (
    <section className="rounded-lg border border-teal-200 bg-teal-50/50 p-4 text-sm text-zinc-800">
      {next ? (
        <p className="flex items-start gap-2">
          <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
          <span>
            <strong>Next:</strong> {next.action}
            <span className="mt-0.5 block text-xs text-zinc-500">
              {[next.owner && `owner ${next.owner}`, next.to && `for ${next.to}`, next.due && `by ${next.due}`].filter(Boolean).join(" · ")}
              {next.basedOn.map((ref) => (
                <Link key={ref} href={`/mailbox/inbox?deal=${encodeURIComponent(shortDealKey(deal))}&mail=${ref}`} className="ml-2 text-teal-700 hover:underline">
                  email {ref.slice(0, 4)}
                </Link>
              ))}
            </span>
          </span>
        </p>
      ) : null}
      {sailing ? <p className="mt-1 text-xs text-zinc-600">Delivery: {sailing}</p> : null}
    </section>
  );
}
