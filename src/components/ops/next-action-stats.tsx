"use client";

import { useEffect, useState } from "react";

type Stats = { total: number; taken: number; rate: number | null; byOwner: Record<string, { total: number; taken: number }> };

/** How often the suggested next step was carried out within two days, overall and per person. */
export function NextActionStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/mail/next-actions", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { stats?: Stats }) => alive && setStats(j.stats || null))
      .catch(() => undefined);
    fetch("/api/mail/quote-use", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { opened?: number }) => alive && setOpened(j.opened ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!stats) return null;
  const owners = Object.entries(stats.byOwner).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span>
          <span className="text-xs text-zinc-500">Next action taken within 2 days</span>{" "}
          <b className="text-lg text-zinc-900">{stats.rate == null ? "—" : `${Math.round(stats.rate * 100)}%`}</b>
          <span className="ml-1 text-xs text-zinc-500">({stats.taken} of {stats.total})</span>
        </span>
        {opened != null ? (
          <span>
            <span className="text-xs text-zinc-500">Quote panel opened</span> <b className="text-zinc-900">{opened}</b>
          </span>
        ) : null}
      </div>
      {owners.length ? (
        <p className="mt-1 text-xs text-zinc-500">
          {owners.map(([o, v]) => `${o.split("@")[0]} ${v.taken}/${v.total}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
