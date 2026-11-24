"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Deal } from "@/types/trade";
import { STAGE_LABELS } from "@/types/trade";
import { collectAllAttention, companyPulse, rankDeals } from "@/lib/trade/opsIntelligence";
import { dealHeadline } from "@/lib/trade/dealDisplay";

const NEEDS_LIMIT = 4;
const QUEUE_LIMIT = 5;

/**
 * The morning brief computed from the book (no agent): headline figures,
 * the critical issues grouped by kind, and the top of the priority queue.
 */
export function LocalBrief({ deals }: { deals: Deal[] }) {
  const data = useMemo(() => {
    const pulse = companyPulse(deals);
    const byId = new Map(deals.map((d) => [d.id, d]));

    const critical = collectAllAttention(deals).filter((a) => a.severity === "critical");
    const groups = new Map<string, { title: string; nextStep: string; items: typeof critical }>();
    for (const a of critical) {
      const g = groups.get(a.title) || { title: a.title, nextStep: a.nextStep, items: [] };
      if (!g.items.some((it) => it.dealId === a.dealId)) g.items.push(a);
      groups.set(a.title, g);
    }
    const needs = [...groups.values()].sort((a, b) => b.items.length - a.items.length);

    const queue = rankDeals(deals)
      .slice(0, QUEUE_LIMIT)
      .map((r) => {
        const deal = byId.get(r.dealId);
        return { ...r, headline: deal ? dealHeadline(deal) : r.title };
      });
    return { pulse, needs, queue };
  }, [deals]);

  const { pulse, needs, queue } = data;

  return (
    <div className="lb">
      <dl className="lb-figures">
        <div>
          <dt>Open deals</dt>
          <dd>{pulse.openDeals.toLocaleString()}</dd>
        </div>
        <div>
          <dt>At risk</dt>
          <dd className={pulse.atRiskCount ? "cc-text-bad" : undefined}>
            {pulse.atRiskCount.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Overdue payments</dt>
          <dd className={pulse.overduePayments ? "cc-text-warn" : undefined}>
            {pulse.overduePayments.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Avg days in a stage</dt>
          <dd>{pulse.avgStageAgeDays.toLocaleString()}</dd>
        </div>
      </dl>

      <section>
        <h3 className="lb-h">Needs you now</h3>
        {needs.length === 0 ? (
          <p className="lb-empty">No critical blockers. Work the warnings and cut-offs.</p>
        ) : (
          <ul className="lb-needs">
            {needs.slice(0, NEEDS_LIMIT).map((g) => (
              <li key={g.title}>
                <div className="lb-needs-top">
                  <span className="lb-needs-title">{g.title}</span>
                  <span className="lb-needs-count">
                    {g.items.length === 1 ? g.items[0].dealCode : `${g.items.length} deals`}
                  </span>
                </div>
                <p className="lb-needs-step">{g.nextStep}</p>
                {g.items.length > 1 ? (
                  <div className="wg-deals">
                    {g.items.slice(0, 3).map((it) => (
                      <Link key={it.id} href={it.href} className="deal-code-chip">
                        {it.dealCode}
                      </Link>
                    ))}
                    {g.items.length > 3 ? (
                      <span className="lb-more">and {g.items.length - 3} more</span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
            {needs.length > NEEDS_LIMIT ? (
              <li className="lb-empty">
                {needs.length - NEEDS_LIMIT} more kinds of critical issue in Priority now.
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {queue.length ? (
        <section>
          <h3 className="lb-h">Top of the queue</h3>
          <ol className="lb-queue">
            {queue.map((r) => (
              <li key={r.dealId}>
                <Link href={`/deals/${encodeURIComponent(r.dealId)}`} className="lb-queue-row">
                  <span className="deal-code-chip">{r.code}</span>
                  <span className="lb-queue-main">
                    <span className="lb-queue-title">{r.headline}</span>
                    <span className="lb-queue-meta">
                      {STAGE_LABELS[r.stage]}
                      {r.reasons[0] ? ` · ${r.reasons.slice(0, 2).join(", ")}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
