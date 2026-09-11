"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { buildFactoryDirectoryPack } from "@/lib/trade/agentDealPack";
import { useTradeStore } from "@/lib/trade/store";
import { getExecutionResult, runWorkerAndWait } from "@/services/agentsApi";
import type {
  Deal,
  DealStage,
  FactoryRecommendation,
  RequirementFields,
} from "@/types/trade";

/** Stages where factory shortlisting is still useful. */
const FACTORY_REC_STAGES: DealStage[] = [
  "requirement",
  "outreach",
  "quoting",
];

export function shouldShowFactoryRecommendations(
  deal: Pick<Deal, "stage" | "parties" | "selectionLocked">,
): boolean {
  if (deal.selectionLocked) return false;
  if (!FACTORY_REC_STAGES.includes(deal.stage)) return false;
  const hasBuyer = deal.parties.some((p) => p.role === "buyer");
  const hasFactory = deal.parties.some((p) => p.role === "factory");
  // Both commercial parties already on the deal — no shortlist needed
  if (hasBuyer && hasFactory) return false;
  return true;
}

export function FactoryRecommendations({
  requirement,
  deal,
  href = "/partners",
}: {
  requirement?: RequirementFields | null;
  /** When provided, hide/skip agent run once buyer+factory exist or stage advanced */
  deal?: Pick<Deal, "stage" | "parties" | "selectionLocked"> | null;
  href?: string;
}) {
  const routing = useTradeStore((s) => s.routing);
  const profiles = useTradeStore((s) => s.partyProfiles);
  const [recs, setRecs] = useState<FactoryRecommendation[]>([]);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = deal ? shouldShowFactoryRecommendations(deal) : true;

  async function runRecommend() {
    if (!requirement || !eligible) return;
    const agentId = routing.factory_recommender;
    if (!agentId) {
      setError("Configure factory_recommender in Agent Routing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ex = await runWorkerAndWait(agentId, {
        requirement_json: JSON.stringify(requirement),
        factories_json: JSON.stringify(buildFactoryDirectoryPack(profiles)),
      });
      if (ex.status !== "completed") {
        throw new Error(ex.error || `Agent ${ex.status}`);
      }
      const r = getExecutionResult(ex) as {
        recommendations?: FactoryRecommendation[];
        summary?: string;
      };
      setRecs(r.recommendations || []);
      setSummary(r.summary || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recommendation failed");
      setRecs([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!requirement || !eligible) return;
    void runRecommend();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when category/cost/eligibility change
  }, [
    eligible,
    requirement?.productCategory,
    requirement?.targetFactoryCost,
    requirement?.materials,
    routing.factory_recommender,
  ]);

  if (!requirement || !eligible) return null;

  return (
    <Card>
      <CardHeader
        title="Recommended factories"
        description="Agent shortlist from partner scores & category fit"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              disabled={busy}
              onClick={() => void runRecommend()}
            >
              {busy ? "…" : "Re-run"}
            </Button>
            <Link href={href} className="text-xs text-teal-700 underline">
              All partners
            </Link>
          </div>
        }
      />
      {error ? (
        <p className="px-4 py-3 text-sm text-amber-800">{error}</p>
      ) : null}
      {busy && !recs.length ? (
        <p className="px-4 py-3 text-sm text-zinc-500">
          Matching partners for this enquiry…
        </p>
      ) : null}
      {summary && recs.length ? (
        <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-600">
          {summary}
        </p>
      ) : null}
      <ul className="divide-y divide-zinc-100">
        {!busy && !recs.length && !error ? (
          <li className="px-4 py-3 text-sm text-zinc-500">
            No recommendations yet.
          </li>
        ) : null}
        {recs.map((r, i) => (
          <li key={r.profileId} className="flex gap-3 px-4 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{r.company}</span>
                <Badge tone="success">{r.score}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {(r.fitReasons || []).join(" · ")}
              </p>
              {r.caution ? (
                <p className="mt-1 text-xs text-amber-800">{r.caution}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
