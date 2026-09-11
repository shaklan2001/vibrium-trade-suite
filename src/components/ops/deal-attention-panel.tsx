"use client";

import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import type { AttentionSeverity, Deal } from "@/types/trade";

function tone(
  s: AttentionSeverity,
): "danger" | "warning" | "info" | "neutral" {
  if (s === "critical") return "danger";
  if (s === "warning") return "warning";
  if (s === "info") return "info";
  return "neutral";
}

export function DealAttentionPanel({ deal }: { deal: Deal }) {
  const opsIntel = useTradeStore((s) => s.opsIntel);
  const items = (opsIntel.attention || []).filter((a) => a.dealId === deal.id);
  const next = items[0] || (opsIntel.todos || []).find((t) => t.dealId === deal.id);

  return (
    <Card>
      <CardHeader
        title="Attention & next steps"
        description="From Command Center agents"
        action={
          <Link href="/home" className="text-xs text-teal-700 underline">
            Refresh
          </Link>
        }
      />
      <div className="space-y-3 px-4 py-3">
        {!opsIntel.agentSourced || !opsIntel.refreshedAt ? (
          <p className="text-sm text-zinc-500">
            Run{" "}
            <Link href="/home" className="text-teal-700 underline">
              Command Center → Refresh intelligence
            </Link>{" "}
            for agent findings on this deal.
          </p>
        ) : null}
        {next ? (
          <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-teal-800">
              Do next
            </div>
            <div className="mt-1 font-medium text-zinc-900">{next.nextStep}</div>
          </div>
        ) : null}
        {opsIntel.agentSourced && items.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Agents flagged no open issues on this deal.
          </p>
        ) : null}
        {items.slice(0, 6).map((a) => (
          <div key={a.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={tone(a.severity)}>{a.severity}</Badge>
              <span className="font-medium">{a.title}</span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">{a.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
