"use client";

import type { BookInsights } from "@/lib/trade/bookInsights";
import { formatMoneyWithRate, getDisplayCurrency, USD_TO_INR } from "@/lib/trade/currencyDisplay";

function trim(x: number) {
  const s = Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Compact money: $9.4M / $412k, ₹7.7 Cr / ₹4.1 L. */
function money(n: number, rate = USD_TO_INR) {
  if (getDisplayCurrency() === "INR") {
    const inr = n * rate;
    if (Math.abs(inr) >= 1e7) return `₹${trim(inr / 1e7)} Cr`;
    if (Math.abs(inr) >= 1e5) return `₹${trim(inr / 1e5)} L`;
    return formatMoneyWithRate(n, "INR", rate);
  }
  if (Math.abs(n) >= 1e6) return `$${trim(n / 1e6)}M`;
  if (Math.abs(n) >= 1e3) return `$${trim(n / 1e3)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

const AGE_COPY: Record<string, string> = {
  "0_7": "1–7 days",
  "8_30": "8–30 days",
  "31_60": "31–60 days",
  "61_plus": "60+ days",
};

/** Book health for Finance / Command Center: overdue by age plus coverage. */
export function BookInsightsStrip({
  insights,
  bookRate = USD_TO_INR,
}: {
  insights: BookInsights;
  bookRate?: number;
}) {
  const max = Math.max(1, ...insights.overdueAging.map((b) => b.amountUsd));
  const lines = insights.overdueAging.reduce((n, b) => n + b.count, 0);
  return (
    <section className="cc-panel book-pulse" aria-labelledby="book-pulse-title">
      <div className="book-pulse-total">
        <h2 id="book-pulse-title" className="book-pulse-label">Overdue across the book</h2>
        <strong className="book-pulse-value">{money(insights.overdueTotalUsd, bookRate)}</strong>
        <span className="book-pulse-sub">
          {lines.toLocaleString()} payment line{lines === 1 ? "" : "s"} past due
        </span>
        <ul className="book-pulse-facts">
          <li>
            <b>{insights.dealCount.toLocaleString()}</b> deals,{" "}
            <b>{insights.coveragePct}%</b> with payment terms
          </li>
          <li>
            Settled in <b>{insights.inrSettlementCount}</b> INR and{" "}
            <b>{insights.usdSettlementCount}</b> USD
          </li>
          <li>
            <b>{insights.shippedCount}</b> past the commission gate
          </li>
        </ul>
      </div>

      <ul className="book-pulse-bars" aria-label="Overdue by age">
        {insights.overdueAging.map((b, i) => (
          <li key={b.key} className="cc-bar-row">
            <span className="cc-bar-label">{AGE_COPY[b.key] || b.label} late</span>
            <span className="cc-bar-track" aria-hidden>
              <span
                className={`cc-bar-fill cc-bar-${i}`}
                style={{ width: `${b.amountUsd ? Math.max(3, (b.amountUsd / max) * 100) : 0}%` }}
              />
            </span>
            <span className="cc-bar-value">
              <strong>{money(b.amountUsd, bookRate)}</strong>
              <span>
                {b.count} line{b.count === 1 ? "" : "s"}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {insights.agency ? (
        <dl className="book-pulse-agency">
          <div>
            <dt>Commission collected</dt>
            <dd className="cc-text-good">
              {money(insights.agency.collectedUsd, bookRate)}
              <small>{insights.agency.collectionPct}%</small>
            </dd>
          </div>
          <div>
            <dt>Commission due</dt>
            <dd className="cc-text-warn">{money(insights.agency.outstandingUsd, bookRate)}</dd>
          </div>
          <div>
            <dt>Commission overdue</dt>
            <dd className="cc-text-bad">{money(insights.agency.overdueUsd, bookRate)}</dd>
          </div>
          <div>
            <dt>Not yet due</dt>
            <dd>{money(insights.agency.notYetDueUsd, bookRate)}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
