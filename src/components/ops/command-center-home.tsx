"use client";

import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { EarlyWarning } from "@/lib/trade/earlyWarnings";
import type { AgingBucket } from "@/lib/trade/bookInsights";

export type PillTone = "flat" | "good" | "warn" | "bad" | "info";

/* ── Hero ─────────────────────────────────────────────────────────────── */

export function CommandHero({
  dateLabel,
  greeting,
  summary,
  chips,
  onRefresh,
  refreshing,
}: {
  dateLabel: string;
  greeting: string;
  summary: ReactNode;
  chips: { label: string; href?: string }[];
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return (
    <section className="cc-hero" aria-labelledby="cc-greeting">
      <div className="cc-hero-top">
        <p className="cc-hero-date">Command Center, {dateLabel}</p>
        <button
          type="button"
          className="cc-hero-refresh"
          onClick={onRefresh}
          aria-label="Refresh data"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
          <span>Refresh</span>
        </button>
      </div>
      <h1 id="cc-greeting" className="cc-hero-title">
        {greeting}
      </h1>
      <p className="cc-hero-summary">{summary}</p>
      {chips.length ? (
        <ul className="cc-hero-chips">
          {chips.map((c) => (
            <li key={c.label}>
              {c.href ? (
                <Link href={c.href} className="cc-chip">
                  {c.label}
                </Link>
              ) : (
                <span className="cc-chip">{c.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  caption,
  tone = "flat",
  href,
}: {
  label: string;
  value: string | number;
  caption?: string;
  tone?: PillTone;
  href?: string;
}) {
  const body = (
    <>
      <span className="cc-tile-label">{label}</span>
      <strong className="cc-tile-value">{value}</strong>
      {caption ? <span className={`cc-pill cc-pill-${tone}`}>{caption}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="cc-tile cc-tile-link">
      {body}
    </Link>
  ) : (
    <div className="cc-tile">{body}</div>
  );
}

/* ── Dark pulse strip ─────────────────────────────────────────────────── */

export function PulseStrip({
  items,
}: {
  items: { label: string; value: string | number; link: string; href: string }[];
}) {
  return (
    <section className="cc-strip" aria-label="Book pulse">
      {items.map((it) => (
        <div key={it.label} className="cc-strip-cell">
          <span className="cc-strip-label">{it.label}</span>
          <strong className="cc-strip-value">{it.value}</strong>
          <Link href={it.href} className="cc-strip-link">
            {it.link}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      ))}
    </section>
  );
}

/* ── Morning brief ────────────────────────────────────────────────────── */

export function MorningBrief({
  dateLabel,
  rows,
}: {
  dateLabel: string;
  rows: { area: string; text: string; href: string }[];
}) {
  return (
    <section className="cc-panel" aria-labelledby="cc-brief">
      <header className="cc-panel-head">
        <h2 id="cc-brief">Morning brief</h2>
        <span className="cc-panel-meta">{dateLabel}</span>
      </header>
      <dl className="cc-brief">
        {rows.map((r) => (
          <div key={r.area} className="cc-brief-row">
            <dt>{r.area}</dt>
            <dd>
              {r.text}{" "}
              <Link href={r.href} className="cc-inline-link">
                Open
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </dd>
          </div>
        ))}
      </dl>
      <p className="cc-panel-foot">
        Figures come from the mailbox book. Agents read the emails; you make the
        calls.
      </p>
    </section>
  );
}

/* ── Priority list (early warnings) ───────────────────────────────────── */

export function PriorityList({
  rows,
  total,
  critical,
  loading,
  error,
}: {
  rows: EarlyWarning[];
  total: number;
  /** Critical count across all warnings, not just the rows shown. */
  critical: number;
  loading: boolean;
  error?: string | null;
}) {
  return (
    <section className="cc-priority" aria-labelledby="cc-priority">
      <header className="cc-priority-head">
        <h2 id="cc-priority">Needs attention</h2>
        <span className="cc-panel-meta">
          {total} open{critical ? `, ${critical} critical` : ""}
        </span>
      </header>
      {error ? (
        <p className="cc-empty cc-empty-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !rows.length ? <p className="cc-empty">Checking the book…</p> : null}
      {!loading && !error && !rows.length ? (
        <p className="cc-empty">Nothing needs you right now.</p>
      ) : null}
      <ol className="cc-priority-list">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`cc-priority-card ${r.severity === "critical" ? "is-critical" : "is-warning"}`}
          >
            <div className="cc-priority-top">
              <span className={`cc-sev ${r.severity === "critical" ? "cc-sev-critical" : "cc-sev-warning"}`}>
                {r.severity === "critical" ? "Critical" : "Warning"}
              </span>
              {r.dealCode ? <span className="cc-code">{r.dealCode}</span> : null}
            </div>
            <Link href={r.href} className="cc-priority-title">
              {r.title}
            </Link>
            <p className="cc-priority-reason">{r.reason}</p>
            {r.mailHref ? (
              <Link href={r.mailHref} className="cc-inline-link">
                Open the email
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── Overdue ageing chart ─────────────────────────────────────────────── */

const AGE_COPY: Record<string, string> = {
  "0_7": "1 to 7 days late",
  "8_30": "8 to 30 days late",
  "31_60": "31 to 60 days late",
  "61_plus": "Over 60 days late",
};

export function OverdueAgeChart({
  buckets,
  total,
  money,
}: {
  buckets: AgingBucket[];
  total: string;
  money: (usd: number) => string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.amountUsd));
  const lines = buckets.reduce((n, b) => n + b.count, 0);
  return (
    <section className="cc-panel" aria-labelledby="cc-ageing">
      <header className="cc-panel-head">
        <div>
          <h2 id="cc-ageing">Overdue payments by age</h2>
          <p className="cc-panel-sub">
            {total} across {lines} payment line{lines === 1 ? "" : "s"}. Older bars
            are harder to recover.
          </p>
        </div>
        <Link href="/finance" className="cc-inline-link">
          Open Finance
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </header>
      <ul className="cc-bars">
        {buckets.map((b, i) => (
          <li key={b.key} className="cc-bar-row">
            <span className="cc-bar-label">{AGE_COPY[b.key] || b.label}</span>
            <span className="cc-bar-track" aria-hidden>
              <span
                className={`cc-bar-fill cc-bar-${i}`}
                style={{ width: `${b.amountUsd ? Math.max(3, (b.amountUsd / max) * 100) : 0}%` }}
              />
            </span>
            <span className="cc-bar-value">
              <strong>{money(b.amountUsd)}</strong>
              <span>
                {b.count} line{b.count === 1 ? "" : "s"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Process shortcuts ────────────────────────────────────────────────── */

export function ProcessCard({
  title,
  description,
  href,
  onOpen,
  stats,
}: {
  title: string;
  description: string;
  href: string;
  onOpen?: () => void;
  stats: { label: string; value: string | number; tone?: PillTone }[];
}) {
  return (
    <Link href={href} onClick={onOpen} className="cc-process">
      <div className="cc-process-head">
        <h3>{title}</h3>
        <ArrowRight className="h-4 w-4" aria-hidden />
      </div>
      <p>{description}</p>
      <dl className="cc-process-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd className={s.tone ? `cc-text-${s.tone}` : undefined}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

/* ── Loading skeleton shaped like the page ────────────────────────────── */

export function CommandCenterSkeleton() {
  return (
    <div className="cc-skeleton" role="status" aria-label="Loading the book">
      <div className="cc-sk cc-sk-hero" />
      <div className="cc-tiles">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="cc-sk cc-sk-tile" />
        ))}
      </div>
      <div className="cc-sk cc-sk-strip" />
      <div className="cc-split">
        <div className="cc-sk cc-sk-panel" />
        <div className="cc-sk cc-sk-panel" />
      </div>
    </div>
  );
}
