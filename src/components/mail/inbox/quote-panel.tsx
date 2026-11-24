"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign } from "lucide-react";
import type { InboxItem } from "@/lib/mail/inboxTypes";
import { isGenericQuoteRequest, isQuoteRequest, quoteRequestItems } from "@/lib/mail/quoteAssist";

type Vendor = {
  vendor: string;
  lastPrices: { unitPrice: number; currency: string | null; qty: number | null; date: string | null; dealId: string; dealCode: string }[];
  deals: number;
  avgDaysLate: number | null;
};

type Found = { text: string; vendors: Vendor[] };

function record(v: Vendor) {
  if (v.avgDaysLate == null) return v.deals ? `${v.deals} deal${v.deals > 1 ? "s" : ""}, no sailing dates yet` : "no delivery record";
  const d = v.avgDaysLate;
  return `${d <= 0 ? `${-d} days early` : `${d} days late`} on average (${v.deals} deals)`;
}

/**
 * Next to a quote request: for each item asked, who supplied it before, the last three prices and
 * how reliably each vendor sails against the agreed ready date. Opening it is counted
 * (POST /api/mail/quote-use) so use can be measured against the number of quote requests.
 */
export function QuotePanel({ item }: { item: InboxItem }) {
  const latest = item.latest;
  const isQuote = useMemo(() => isQuoteRequest(latest), [latest]);
  const generic = useMemo(() => isGenericQuoteRequest(latest), [latest]);
  const asked = useMemo(() => (isQuote ? quoteRequestItems(latest.body).slice(0, 4) : []), [isQuote, latest.body]);
  const [found, setFound] = useState<Found[] | null>(null);

  useEffect(() => {
    if (!asked.length) return;
    let cancelled = false;
    (async () => {
      const out: Found[] = [];
      for (const a of asked) {
        try {
          const r = await fetch(`/api/products/search?q=${encodeURIComponent(a.code || a.text)}`, { cache: "no-store" });
          const j = (await r.json()) as { vendors?: Vendor[] };
          out.push({ text: a.text, vendors: j.vendors || [] });
        } catch {
          out.push({ text: a.text, vendors: [] });
        }
      }
      if (cancelled) return;
      setFound(out);
      void fetch("/api/mail/quote-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal: item.dealId || item.id, messageId: latest.id, items: asked.length }),
      }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [asked, item.dealId, item.id, latest.id]);

  if (!isQuote) return null;
  if (generic) {
    return (
      <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">
          <BadgeDollarSign className="h-3.5 w-3.5" /> Quote request
        </p>
        <p className="mt-1">They did not name products. The draft asks which items, quantities, target price and destination.</p>
      </section>
    );
  }
  if (!asked.length) return null;
  return (
    <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-3" aria-live="polite">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">
        <BadgeDollarSign className="h-3.5 w-3.5" /> Quote help from past orders
      </p>
      {!found ? <p className="mt-2 text-xs text-zinc-500">Looking up past POs and PIs…</p> : null}
      {found?.map((f) => (
        <div key={f.text} className="mt-2 border-t border-zinc-100 pt-2 first:border-0 first:pt-0">
          <p className="text-xs font-medium text-zinc-900">{f.text}</p>
          {f.vendors.length ? (
            <ul className="mt-1 space-y-1 text-xs text-zinc-600">
              {f.vendors.slice(0, 3).map((v) => (
                <li key={v.vendor}>
                  <span className="font-medium text-zinc-800">{v.vendor}</span> — {record(v)}
                  <div className="text-zinc-500">
                    {v.lastPrices.map((p, i) => (
                      <span key={`${p.dealId}-${i}`} className="mr-2">
                        {p.currency || ""} {p.unitPrice}
                        {p.date ? ` (${p.date.slice(0, 7)}` : " ("}
                        <Link href={`/deals/${encodeURIComponent(p.dealId)}`} className="text-teal-700 hover:underline">
                          {p.dealCode}
                        </Link>
                        )
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">Not found in past POs or PIs.</p>
          )}
        </div>
      ))}
    </section>
  );
}
