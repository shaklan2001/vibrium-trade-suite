"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Button, Card, CardHeader, Stat } from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { readinessClassLabel } from "@/lib/trade/supplierOnboarding";

export default function PartnersPage() {
  const profiles = useTradeStore((s) => s.partyProfiles);
  const applications = useTradeStore((s) => s.supplierApplications);
  const deleteApplication = useTradeStore((s) => s.deleteSupplierApplication);

  const buyers = profiles.filter((p) => p.role === "buyer");
  const factories = profiles.filter((p) => p.role === "factory");
  const drafts = applications.filter((a) => a.status === "draft");
  const submitted = applications.filter((a) => a.status === "submitted");
  const hubFactories = factories.filter((p) => p.sourceApplicationId);

  return (
    <div>
      <PageHeader
        title="Supplier Hub"
        description="Buyer & factory directory for recommendations. Onboard manufacturers here — submitted factories are scored and eligible for deal mapping immediately."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/partners/onboard">
              <Button>Onboard supplier</Button>
            </Link>
            <Link href="/supplier-hub">
              <Button variant="secondary">Supplier self-serve link</Button>
            </Link>
            <Link href="/partners/commissions">
              <Button variant="secondary">Agency commissions</Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Buyers" value={buyers.length} />
        <Stat label="Factories" value={factories.length} />
        <Stat label="HUB onboarded" value={hubFactories.length} />
        <Stat
          label="Avg factory score"
          value={
            factories.length
              ? Math.round(
                  factories.reduce((a, p) => a + p.scores.overall, 0) /
                    factories.length,
                )
              : "—"
          }
        />
      </div>

      {(drafts.length > 0 || submitted.length > 0) && (
        <Card className="mb-4">
          <CardHeader
            title="Supplier HUB applications"
            description="Drafts and submitted onboarding forms"
          />
          <ul className="divide-y divide-zinc-100">
            {[...applications]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900">
                      {a.company.legalName || "Untitled application"}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {a.filledBy === "ops" ? "Ops" : "Supplier"}
                      {a.reference ? ` · ${a.reference}` : ""}
                      {a.assessment.totalScore
                        ? ` · readiness ${a.assessment.totalScore}/100`
                        : ""}
                      {a.assessment.classification
                        ? ` · ${readinessClassLabel(a.assessment.classification)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={a.status === "submitted" ? "success" : "warning"}
                    >
                      {a.status}
                    </Badge>
                    <Link
                      href={`/partners/onboard?id=${a.id}${
                        a.filledBy === "supplier" ? "&mode=supplier" : ""
                      }`}
                    >
                      <Button variant="secondary" className="px-2 py-1 text-xs">
                        {a.status === "submitted" ? "View / update" : "Continue"}
                      </Button>
                    </Link>
                    {a.status === "draft" ? (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs text-red-700"
                        onClick={() => deleteApplication(a.id)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Buyers" description="Importers on the book" />
          <ul className="divide-y divide-zinc-100">
            {buyers.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{p.company}</div>
                    <div className="text-xs text-zinc-500">
                      {p.name}
                      {p.country ? ` · ${p.country}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.categories.map((c) => (
                        <Badge key={c}>{c}</Badge>
                      ))}
                    </div>
                    {p.notes ? (
                      <p className="mt-1 text-xs text-zinc-500">{p.notes}</p>
                    ) : null}
                  </div>
                  <span className="rounded-md bg-teal-800 px-2 py-1 text-sm font-semibold text-white">
                    {p.scores.overall}
                  </span>
                </div>
                <ScoreBars scores={p.scores} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Factories"
            description="Capacity & reliability scoring — HUB profiles include readiness"
          />
          <ul className="divide-y divide-zinc-100">
            {factories.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium">{p.company}</div>
                      {p.sourceApplicationId ? (
                        <Badge tone="info">HUB</Badge>
                      ) : null}
                      {p.readinessClass ? (
                        <Badge
                          tone={
                            p.readinessClass === "export_ready"
                              ? "success"
                              : p.readinessClass ===
                                  "export_ready_with_conditions"
                                ? "info"
                                : p.readinessClass === "partially_export_ready"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {readinessClassLabel(p.readinessClass)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {p.name}
                      {p.city ? ` · ${p.city}` : ""}
                      {p.country ? ` · ${p.country}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.categories.map((c) => (
                        <Badge key={c}>{c}</Badge>
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {p.avgLeadDays != null ? `Lead ~${p.avgLeadDays}d` : ""}
                      {p.moqTypical != null ? ` · MOQ ~${p.moqTypical}` : ""}
                      {p.readinessScore != null
                        ? ` · readiness ${p.readinessScore}`
                        : ""}
                    </div>
                    {p.certifications?.length ? (
                      <div className="mt-1 text-[11px] text-zinc-500">
                        Certs: {p.certifications.join(", ")}
                      </div>
                    ) : null}
                    {p.notes ? (
                      <p className="mt-1 text-xs text-zinc-500">{p.notes}</p>
                    ) : null}
                    {p.sourceApplicationId ? (
                      <Link
                        href={`/partners/onboard?id=${p.sourceApplicationId}`}
                        className="mt-1 inline-block text-[11px] text-teal-700 underline"
                      >
                        Open HUB application
                      </Link>
                    ) : null}
                  </div>
                  <span className="rounded-md bg-zinc-900 px-2 py-1 text-sm font-semibold text-white">
                    {p.scores.overall}
                  </span>
                </div>
                <ScoreBars scores={p.scores} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Recommendations appear on intake and deal rooms.{" "}
        <Link href="/intake" className="text-teal-700 underline">
          Start a new enquiry
        </Link>
        {" · "}
        <Link href="/supplier-hub" className="text-teal-700 underline">
          Share supplier self-serve form
        </Link>
        .
      </p>
    </div>
  );
}

function ScoreBars({
  scores,
}: {
  scores: {
    size: number;
    output: number;
    onTimeDelivery: number;
    shipmentReliability: number;
    quality: number;
  };
}) {
  const rows = [
    ["Size", scores.size],
    ["Output", scores.output],
    ["On-time", scores.onTimeDelivery],
    ["Shipments", scores.shipmentReliability],
    ["Quality", scores.quality],
  ] as const;
  return (
    <div className="mt-2 grid gap-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2 text-[10px]">
          <span className="w-16 text-zinc-500">{label}</span>
          <div className="h-1.5 flex-1 rounded-full bg-zinc-100">
            <div
              className="h-1.5 rounded-full bg-teal-600"
              style={{ width: `${value}%` }}
            />
          </div>
          <span className="w-6 text-right font-medium text-zinc-700">{value}</span>
        </div>
      ))}
    </div>
  );
}
