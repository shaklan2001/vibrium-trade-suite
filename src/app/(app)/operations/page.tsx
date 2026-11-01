"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
} from "@/components/ui/primitives";
import { MarkdownMessage } from "@/components/copilot/markdown-message";
import {
  ExpandSection,
  KpiTile,
  ProvenanceList,
} from "@/components/ops/command-center-ui";
import {
  ChartDrillPanel,
  type DrillPayload,
} from "@/components/ops/chart-drill-panel";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { companyPulse } from "@/lib/trade/opsIntelligence";
import { hydrateMailboxBook } from "@/lib/trade/mailboxHydrate";
import {
  buildDealEconomicsList,
  buildShipmentPulseFromDeals,
} from "@/lib/trade/commandCenterMetrics";
import { refreshOpsIntelligence } from "@/lib/trade/refreshOpsIntelligence";
import type { CashDrillDeal } from "@/lib/trade/cashExposure";
import {
  STAGE_LABELS,
  type AttentionSeverity,
} from "@/types/trade";

const TEAL = "#0f766e";
const AMBER = "#d97706";
const RED = "#dc2626";
const SKY = "#0284c7";
const EMERALD = "#059669";

function severityTone(
  s: AttentionSeverity,
): "danger" | "warning" | "info" | "neutral" {
  if (s === "critical") return "danger";
  if (s === "warning") return "warning";
  return "neutral";
}

function shortCode(code?: string) {
  if (!code) return "—";
  const m = code.match(/(\d{3,})$/);
  return m ? m[1] : code.slice(-6);
}

export default function OperationsDashboardPage() {
  const deals = useVisibleDeals();
  const routing = useTradeStore((s) => s.routing);
  const opsIntel = useTradeStore((s) => s.opsIntel);
  const setOpsIntel = useTradeStore((s) => s.setOpsIntel);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const mailboxStatus = useTradeStore((s) => s.mailboxBookStatus);
  const [drill, setDrill] = useState<DrillPayload | null>(null);

  useEffect(() => {
    if (mailboxStatus === "idle") void hydrateMailboxBook();
  }, [mailboxStatus]);
  useTradeStore((s) => s.displayCurrency);
  const bookLoading =
    mailboxStatus === "idle" || mailboxStatus === "loading";
  const hydrated = mailboxStatus === "ready" || mailboxStatus === "error";

  const pulse = useMemo(() => companyPulse(deals), [deals]);
  const shipment = opsIntel.shipment || buildShipmentPulseFromDeals(deals);
  const economics = useMemo(() => {
    const list = opsIntel.dealEconomics?.length
      ? opsIntel.dealEconomics
      : buildDealEconomicsList(deals);
    return list.map((e) => {
      const deal = deals.find((d) => d.id === e.dealId);
      return {
        ...e,
        dealId: e.dealId || deal?.id,
        dealCode: e.dealCode || deal?.code,
        title: e.title || deal?.title,
      };
    });
  }, [opsIntel.dealEconomics, deals]);

  const attention = useMemo(
    () => (opsIntel.attention || []).filter((a) => a.severity !== "info"),
    [opsIntel.attention],
  );
  const todos = useMemo(() => opsIntel.todos || [], [opsIntel.todos]);
  const rankedView = useMemo(() => opsIntel.ranked || [], [opsIntel.ranked]);
  const brief = opsIntel.briefMarkdown || "";
  const criticalN = attention.filter((a) => a.severity === "critical").length;
  const warningN = attention.filter((a) => a.severity === "warning").length;

  const stageBars = useMemo(() => {
    return Object.entries(pulse.byStage)
      .filter(([, n]) => n > 0)
      .map(([stage, n]) => {
        const stageDeals = deals.filter((d) => d.stage === stage);
        return {
          s: (STAGE_LABELS[stage as keyof typeof STAGE_LABELS] || stage).slice(
            0,
            12,
          ),
          stage,
          n,
          deals: stageDeals.map(
            (d): CashDrillDeal => ({
              dealId: d.id,
              dealCode: d.code,
              title: d.title,
              amountUsd: d.economics?.commercialValueUsd || 0,
              meta: STAGE_LABELS[d.stage],
              sources: (d.sources || []).slice(0, 3).map((s) => ({
                dealId: d.id,
                dealCode: d.code,
                sourceId: s.id,
                kind: s.kind,
                subject: s.subject,
                from: s.from,
                excerpt: (s.extractedSummary || s.body || "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 160),
              })),
              href: `/deals/${d.id}`,
            }),
          ),
        };
      });
  }, [pulse.byStage, deals]);

  const shipmentPie = useMemo(
    () =>
      [
        { name: "Arrive", value: shipment.aboutToCome, fill: EMERALD, key: "about_to_come" as const },
        { name: "Sail", value: shipment.aboutToGo, fill: AMBER, key: "about_to_go" as const },
        { name: "Waters", value: shipment.inWaters, fill: SKY, key: "in_waters" as const },
      ].filter((d) => d.value > 0),
    [shipment],
  );

  const cycleBars = useMemo(
    () =>
      economics
        .filter((e) => e.cycleDaysElapsed > 0)
        .map((e) => ({
          code: shortCode(e.dealCode),
          fullCode: e.dealCode,
          Elapsed: e.cycleDaysElapsed,
          Typical: e.cycleDaysTypical,
          dealId: e.dealId,
          sources: e.sources,
          title: e.title || "",
        }))
        .sort((a, b) => b.Elapsed - a.Elapsed)
        .slice(0, 8),
    [economics],
  );

  const runIntelligence = useCallback(async () => {
    if (!deals.length) return;
    setBusy(true);
    try {
      const patch = await refreshOpsIntelligence({
        deals,
        routing,
        onStatus: setStatus,
      });
      setOpsIntel(patch);
      toast.success("Ops intelligence updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }, [deals, routing, setOpsIntel]);

  useEffect(() => {
    if (!hydrated || !deals.length || busy) return;
    const day = new Date().toISOString().slice(0, 10);
    if (
      opsIntel.agentSourced &&
      opsIntel.lastAutoDayKey === day &&
      opsIntel.briefMarkdown
    )
      return;
    void runIntelligence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, deals.length]);

  function openShip(posture: "about_to_come" | "about_to_go" | "in_waters") {
    const lines = shipment.lines.filter((l) => l.posture === posture);
    setDrill({
      title:
        posture === "about_to_come"
          ? "About to arrive"
          : posture === "about_to_go"
            ? "About to sail"
            : "In waters",
      deals: lines.map((l) => ({
        dealId: l.dealId,
        dealCode: l.dealCode,
        title: l.title,
        amountUsd: 0,
        meta: [l.etd && `ETD ${l.etd}`, l.eta && `ETA ${l.eta}`]
          .filter(Boolean)
          .join(" · "),
        sources: l.sources,
        href: `/deals/${l.dealId}`,
      })),
    });
  }

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Sourcing execution across the book — brief, risk, priorities, pipeline, and shipments."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/home">
              <Button variant="ghost">Command Center</Button>
            </Link>
            <Button disabled={busy} onClick={() => void runIntelligence()}>
              {busy ? status || "Updating…" : "Refresh intelligence"}
            </Button>
          </div>
        }
      />

      {bookLoading ? (
        <div className="mb-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-700" />
          <p className="text-sm font-medium text-zinc-700">
            Loading operations book…
          </p>
        </div>
      ) : null}

      <div
        className={`mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5 ${bookLoading ? "pointer-events-none opacity-40" : ""}`}
      >
        <KpiTile size="lg" label="Open" value={pulse.openDeals} />
        <KpiTile
          size="lg"
          label="Critical"
          value={criticalN}
          tone={criticalN ? "danger" : "success"}
        />
        <KpiTile
          size="lg"
          label="Warnings"
          value={warningN}
          tone={warningN ? "warning" : "neutral"}
        />
        <KpiTile
          size="lg"
          label="Sail"
          value={shipment.aboutToGo}
          tone="warning"
        />
        <KpiTile
          size="lg"
          label="Waters"
          value={shipment.inWaters}
          tone="info"
        />
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Morning brief"
            description={
              opsIntel.riskSummary
                ? opsIntel.riskSummary.slice(0, 160)
                : "Daily operating snapshot"
            }
          />
          <div className="max-h-56 overflow-auto px-4 py-3 text-sm">
            {brief ? (
              <MarkdownMessage content={brief} />
            ) : (
              <p className="text-zinc-500">
                {busy
                  ? "Preparing brief…"
                  : "Refresh intelligence to load today’s brief."}
              </p>
            )}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Priority now"
            description={`${attention.length} alerts · ${todos.length} todos`}
          />
          <div className="max-h-56 divide-y divide-zinc-100 overflow-auto">
            {attention.slice(0, 5).map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="block px-4 py-2.5 hover:bg-zinc-50"
              >
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {a.dealCode}
                  </span>
                </div>
                <div className="text-sm font-medium">{a.title}</div>
                <div className="text-xs text-teal-800">→ {a.nextStep}</div>
              </Link>
            ))}
            {todos.slice(0, 3).map((t, i) => (
              <Link
                key={t.id}
                href={t.href}
                className="flex gap-2 px-4 py-2.5 hover:bg-zinc-50"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium">{t.nextStep}</div>
                  <div className="font-mono text-[11px] text-zinc-500">
                    {t.dealCode}
                  </div>
                </div>
              </Link>
            ))}
            {!attention.length && !todos.length ? (
              <p className="px-4 py-3 text-sm text-zinc-500">
                No open priorities. Refresh intelligence when the book changes.
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Pipeline by stage
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageBars} layout="vertical" margin={{ left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="s" width={78} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar
                  dataKey="n"
                  name="Deals"
                  fill={TEAL}
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(data) => {
                    const row = data as unknown as {
                      deals?: CashDrillDeal[];
                      s?: string;
                    };
                    if (row?.deals)
                      setDrill({
                        title: `Stage · ${row.s}`,
                        deals: row.deals,
                      });
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Shipments
            </div>
            <Link
              href="/shipments"
              className="text-[11px] font-medium text-teal-700 hover:underline"
            >
              Open map →
            </Link>
          </div>
          <div className="flex h-56 items-center gap-2">
            <div className="h-full w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      shipmentPie.length
                        ? shipmentPie
                        : [{ name: "None", value: 1, fill: "#e4e4e7", key: "about_to_go" as const }]
                    }
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={70}
                    paddingAngle={3}
                    cursor="pointer"
                    onClick={(_, i) => {
                      const row = shipmentPie[i];
                      if (row) openShip(row.key);
                    }}
                  >
                    {(shipmentPie.length
                      ? shipmentPie
                      : [{ fill: "#e4e4e7" }]
                    ).map((d, i) => (
                      <Cell key={i} fill={"fill" in d ? d.fill : TEAL} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid w-1/2 gap-2">
              <button type="button" className="text-left" onClick={() => openShip("about_to_come")}>
                <KpiTile label="Arrive" value={shipment.aboutToCome} tone="success" />
              </button>
              <button type="button" className="text-left" onClick={() => openShip("about_to_go")}>
                <KpiTile label="Sail" value={shipment.aboutToGo} tone="warning" />
              </button>
              <button type="button" className="text-left" onClick={() => openShip("in_waters")}>
                <KpiTile label="Waters" value={shipment.inWaters} tone="info" />
              </button>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Cycle time · elapsed vs typical
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cycleBars} layout="vertical" margin={{ left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="code"
                  width={40}
                  tick={{ fontSize: 11, fontFamily: "ui-monospace" }}
                />
                <Tooltip
                  labelFormatter={(_, p) => p?.[0]?.payload?.fullCode || ""}
                />
                <Bar dataKey="Typical" fill="#d4d4d8" radius={[0, 3, 3, 0]} />
                <Bar
                  dataKey="Elapsed"
                  fill={TEAL}
                  radius={[0, 3, 3, 0]}
                  cursor="pointer"
                  onClick={(data) => {
                    const row = data as unknown as {
                      dealId?: string;
                      fullCode?: string;
                      title?: string;
                      sources?: CashDrillDeal["sources"];
                      Elapsed?: number;
                    };
                    if (row?.dealId)
                      setDrill({
                        title: `Cycle · ${row.fullCode}`,
                        deals: [
                          {
                            dealId: row.dealId,
                            dealCode: row.fullCode || "",
                            title: row.title || "",
                            amountUsd: row.Elapsed || 0,
                            meta: `${row.Elapsed}d elapsed`,
                            sources: row.sources || [],
                            href: `/deals/${row.dealId}`,
                          },
                        ],
                      });
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Priority queue"
          description={
            opsIntel.prioritySummary ||
            "Ranked work order for the current book"
          }
        />
        {rankedView.length ? (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rankedView.slice(0, 8).map((r) => ({
                    code: shortCode(r.code),
                    full: r.code,
                    score: r.score,
                    dealId: r.dealId,
                    title: r.title,
                  }))}
                >
                  <XAxis
                    dataKey="code"
                    tick={{ fontSize: 11, fontFamily: "ui-monospace" }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
                  <Tooltip labelFormatter={(_, p) => p?.[0]?.payload?.full || ""} />
                  <Bar
                    dataKey="score"
                    fill="#18181b"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(data) => {
                      const row = data as unknown as {
                        dealId?: string;
                        full?: string;
                        title?: string;
                        score?: number;
                      };
                      if (!row?.dealId) return;
                      const deal = deals.find((d) => d.id === row.dealId);
                      setDrill({
                        title: `Priority · ${row.full}`,
                        deals: [
                          {
                            dealId: row.dealId,
                            dealCode: row.full || "",
                            title: row.title || "",
                            amountUsd: row.score || 0,
                            meta: `Score ${row.score}`,
                            sources: (deal?.sources || []).slice(0, 3).map((s) => ({
                              dealId: deal!.id,
                              dealCode: deal!.code,
                              sourceId: s.id,
                              kind: s.kind,
                              subject: s.subject,
                              from: s.from,
                              excerpt: (s.extractedSummary || s.body || "")
                                .replace(/\s+/g, " ")
                                .trim()
                                .slice(0, 160),
                            })),
                            href: `/deals/${row.dealId}`,
                          },
                        ],
                      });
                    }}
                  >
                    {rankedView.slice(0, 8).map((r, i) => (
                      <Cell
                        key={r.dealId}
                        fill={i < 3 ? RED : i < 5 ? AMBER : "#3f3f46"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ol className="divide-y divide-zinc-100">
              {rankedView.slice(0, 6).map((r, i) => (
                <li key={r.dealId}>
                  <Link
                    href={`/deals/${r.dealId}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white">
                          {i + 1}
                        </span>
                        <span className="font-mono text-xs text-zinc-500">
                          {r.code}
                        </span>
                      </div>
                      <div className="truncate text-sm font-medium">{r.title}</div>
                      {r.reasons[0] ? (
                        <div className="truncate text-xs text-zinc-500">
                          {r.reasons[0]}
                        </div>
                      ) : null}
                    </div>
                    <span className="rounded-md bg-zinc-900 px-2 py-1 font-mono text-sm text-white">
                      {r.score}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-zinc-500">
            Refresh intelligence to load the priority ranking.
          </p>
        )}
      </Card>

      <ExpandSection id="econ" title="Deal cycle detail" badge={`${economics.length}`}>
        <table className="min-w-full text-left text-xs">
          <thead className="text-[10px] uppercase text-zinc-400">
            <tr>
              <th className="py-1">Code</th>
              <th className="py-1">Days</th>
              <th className="py-1">Band</th>
              <th className="py-1">Src</th>
            </tr>
          </thead>
          <tbody>
            {economics.map((e) => (
              <tr key={e.dealId || e.dealCode} className="border-t border-zinc-50">
                <td className="py-1.5">
                  {e.dealId ? (
                    <Link
                      href={`/deals/${e.dealId}`}
                      className="font-mono text-teal-800 underline"
                    >
                      {e.dealCode}
                    </Link>
                  ) : (
                    e.dealCode
                  )}
                </td>
                <td className="py-1.5 font-mono">
                  {e.cycleDaysElapsed}/{e.cycleDaysTypical}
                </td>
                <td className="py-1.5">
                  <Badge
                    tone={
                      e.affordability === "blocked"
                        ? "danger"
                        : e.affordability === "tight"
                          ? "warning"
                          : "success"
                    }
                  >
                    {e.affordability}
                  </Badge>
                </td>
                <td className="relative py-1.5">
                  <ProvenanceList sources={e.sources} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ExpandSection>

      <ChartDrillPanel drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
