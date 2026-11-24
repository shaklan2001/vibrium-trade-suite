"use client";

import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import type { WarningGroup } from "@/lib/trade/groupWarnings";

const PREVIEW = 4;
const MAX_EXPANDED = 80;

/** One row per distinct warning; deals that share it are listed as chips. */
export function WarningGroups({
  groups,
  limit,
  compact = false,
}: {
  groups: WarningGroup[];
  limit?: number;
  /** Flat rows inside a card (Operations) instead of separate cards (Command Center). */
  compact?: boolean;
}) {
  const shown = limit ? groups.slice(0, limit) : groups;
  return (
    <ol className={`wg-list ${compact ? "wg-compact" : ""}`}>
      {shown.map((g) => {
        const single = g.items.length === 1 ? g.items[0] : null;
        const critical = g.severity === "critical";
        return (
          <li key={g.key} className={`wg-item ${critical ? "is-critical" : "is-warning"}`}>
            <div className="wg-top">
              <span className={`cc-sev ${critical ? "cc-sev-critical" : "cc-sev-warning"}`}>
                {critical ? "Critical" : "Warning"}
              </span>
              <span className="wg-count">
                {single
                  ? single.dealCode || "Whole book"
                  : `${g.items.length.toLocaleString()} deals`}
              </span>
            </div>
            {single ? (
              <Link href={single.href} className="wg-title wg-title-link">
                {g.title}
              </Link>
            ) : (
              <span className="wg-title">{g.title}</span>
            )}
            <p className="wg-reason">{g.reason}</p>

            {single ? (
              single.mailHref ? (
                <Link href={single.mailHref} className="cc-inline-link">
                  <Mail className="h-3 w-3" aria-hidden />
                  Open the email
                </Link>
              ) : null
            ) : (
              <div className="wg-deals">
                {g.items.slice(0, PREVIEW).map((it) => (
                  <Link key={it.id} href={it.href} className="deal-code-chip" title={it.reason}>
                    {it.dealCode || "Deal"}
                  </Link>
                ))}
                {g.items.length > PREVIEW ? (
                  <details className="wg-more">
                    <summary>
                      {g.items.length - PREVIEW} more
                    </summary>
                    <div className="wg-deals">
                      {g.items.slice(PREVIEW, MAX_EXPANDED).map((it) => (
                        <Link key={it.id} href={it.href} className="deal-code-chip">
                          {it.dealCode || "Deal"}
                        </Link>
                      ))}
                      {g.items.length > MAX_EXPANDED ? (
                        <Link href="/deals" className="cc-inline-link">
                          All on the Deal Board
                          <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
