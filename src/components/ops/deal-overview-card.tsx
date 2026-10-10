"use client";

import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { Deal, SourceMessage } from "@/types/trade";
import { STAGE_LABELS } from "@/types/trade";
import { dealCommercialModel } from "@/lib/trade/commercialModel";
import { formatMoney } from "@/lib/trade/currencyDisplay";
import { OpenableFileLink } from "@/components/ops/openable-file-link";

function recentSources(sources: SourceMessage[], limit = 5) {
  return [...sources]
    .sort(
      (a, b) =>
        Date.parse(b.receivedAt || "") - Date.parse(a.receivedAt || ""),
    )
    .slice(0, limit);
}

function overviewBullets(deal: Deal): string[] {
  const bullets: string[] = [];
  const model = dealCommercialModel(deal);
  bullets.push(
    model === "trader_principal"
      ? "Trader book · Global Praise principal"
      : "Agency book · SNSPL referee",
  );
  bullets.push(`Stage: ${STAGE_LABELS[deal.stage]}`);

  const buyer = deal.parties.find((p) => p.role === "buyer");
  const factory = deal.parties.find((p) => p.role === "factory");
  if (buyer?.name || buyer?.company) {
    bullets.push(`Buyer: ${buyer.company || buyer.name}`);
  }
  if (factory?.name || factory?.company) {
    bullets.push(`Factory: ${factory.company || factory.name}`);
  }

  const value =
    deal.po?.totalAmount ||
    deal.pi?.totalAmount ||
    deal.payment?.amountUsd ||
    deal.economics?.commercialValueUsd;
  if (value) {
    bullets.push(
      `Commercial value: ${formatMoney(value)}${
        deal.po?.currency || deal.pi?.currency || deal.payment?.currency
          ? ` (${deal.po?.currency || deal.pi?.currency || deal.payment?.currency})`
          : ""
      }`,
    );
  }

  if (deal.payment?.dueDate) {
    bullets.push(
      `Payment clock: ${deal.payment.status || "pending"} · due ${deal.payment.dueDate}`,
    );
  }
  if (deal.booking?.vessel || deal.booking?.etd) {
    bullets.push(
      `Logistics: ${[deal.booking.vessel, deal.booking.pol && deal.booking.pod ? `${deal.booking.pol}→${deal.booking.pod}` : null, deal.booking.etd ? `ETD ${deal.booking.etd}` : null].filter(Boolean).join(" · ")}`,
    );
  }
  if (deal.production?.readyDate) {
    bullets.push(`Production ready: ${deal.production.readyDate}`);
  }
  if (deal.docsPack && !deal.docsPack.complete && deal.docsPack.missing?.length) {
    bullets.push(`Docs missing: ${deal.docsPack.missing.slice(0, 4).join(", ")}`);
  }

  const msgs = deal.sources?.length || 0;
  const docs = deal.documents?.length || 0;
  if (msgs || docs) {
    bullets.push(`Evidence: ${msgs} message${msgs === 1 ? "" : "s"} · ${docs} file${docs === 1 ? "" : "s"}`);
  }
  return bullets;
}

/** Gmail / Gemini-style deal overview card. */
export function DealOverviewCard({
  deal,
  sources,
}: {
  deal: Deal;
  sources?: SourceMessage[];
}) {
  const src = sources || deal.sources || [];
  const summary =
    deal.requirement?.summary ||
    (typeof deal.agentResult?.summary === "string"
      ? deal.agentResult.summary
      : null) ||
    deal.payment?.summary ||
    deal.booking?.summary ||
    deal.po?.summary ||
    deal.pi?.summary ||
    deal.title;

  const bullets = overviewBullets(deal);
  const recent = recentSources(src, 6);
  const files = [
    ...deal.documents.filter((d) => d.url || d.samplePath),
    ...src.flatMap((s) =>
      (s.attachments || [])
        .filter((a) => a.url || a.samplePath)
        .map((a) => ({
          id: `${s.id}-${a.name}`,
          name: a.name,
          url: a.url,
          samplePath: a.samplePath,
          uploadedAt: s.receivedAt || deal.updatedAt,
          type: "other" as const,
        })),
    ),
  ];
  // de-dupe by name
  const seen = new Set<string>();
  const uniqueFiles = files.filter((f) => {
    const key = f.name || f.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <Card>
      <CardHeader
        title="Deal overview"
        description="Short brief from mailbox extract · recent activity"
      />
      <div className="space-y-4 px-4 py-3">
        <p className="text-sm leading-relaxed text-zinc-800">{summary}</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex gap-2 text-xs text-zinc-700 before:mt-1.5 before:h-1 before:w-1 before:shrink-0 before:rounded-full before:bg-teal-700 before:content-['']"
            >
              {b}
            </li>
          ))}
        </ul>

        {recent.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Recent mail
            </div>
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-100">
              {recent.map((s) => (
                <li key={s.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">{s.kind}</Badge>
                    <span className="text-sm font-medium text-zinc-900">
                      {s.subject || s.label || "Message"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {s.from || "—"}
                    {s.receivedAt
                      ? ` · ${new Date(s.receivedAt).toLocaleString()}`
                      : ""}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600">
                    {(s.body || "").replace(/\s+/g, " ").slice(0, 220)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {uniqueFiles.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Source files
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {uniqueFiles.slice(0, 8).map((f) => (
                <OpenableFileLink
                  key={f.id}
                  name={f.name}
                  url={"url" in f ? f.url : undefined}
                  samplePath={"samplePath" in f ? f.samplePath : undefined}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
