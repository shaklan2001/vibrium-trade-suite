"use client";

import { ChannelBadge } from "@/components/ui/primitives";
import {
  dealDayNumber,
  formatDealDate,
} from "@/lib/trade/dealCode";
import type { TimelineEvent } from "@/types/trade";

export function DealTimeline({
  createdAt,
  events,
}: {
  createdAt: string;
  events: TimelineEvent[];
}) {
  // Chronological for Day N reading (oldest first)
  const ordered = [...events].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );

  return (
    <div className="divide-y divide-zinc-100">
      {ordered.map((e) => {
        const day = dealDayNumber(createdAt, e.at);
        return (
          <div key={e.id} className="flex gap-3 px-4 py-3">
            <div className="w-16 shrink-0 text-center">
              <div className="rounded-md bg-teal-800 px-1.5 py-1 text-[11px] font-bold tracking-wide text-white">
                Day {day}
              </div>
              <div className="mt-1.5 text-[11px] font-semibold text-zinc-800">
                {formatDealDate(e.at)}
              </div>
              <div className="text-[10px] text-zinc-400">
                {new Date(e.at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ChannelBadge channel={e.channel} />
                <div className="text-sm font-medium text-zinc-900">{e.title}</div>
              </div>
              {e.detail ? (
                <div className="mt-0.5 text-xs text-zinc-500">{e.detail}</div>
              ) : null}
            </div>
          </div>
        );
      })}
      {ordered.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-500">No timeline events yet.</p>
      ) : null}
    </div>
  );
}
