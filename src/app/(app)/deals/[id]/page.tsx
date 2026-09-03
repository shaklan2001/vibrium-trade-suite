"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ChannelBadge,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { STAGE_LABELS } from "@/types/trade";

export default function DealRoomPage() {
  const params = useParams<{ id: string }>();
  const deal = useTradeStore((s) => s.deals.find((d) => d.id === params.id));
  const deleteDeal = useTradeStore((s) => s.deleteDeal);

  if (!deal) {
    return (
      <div>
        <PageHeader title="Deal not found" />
        <Link href="/deals" className="text-sm text-teal-700 underline">
          Back to board
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={deal.title}
        description={`${STAGE_LABELS[deal.stage]} · ${deal.id.slice(0, 8)}`}
        actions={
          <div className="flex gap-2">
            <Link href="/intake">
              <Button variant="secondary">Intake</Button>
            </Link>
            <Link href="/quotes">
              <Button variant="secondary">Quotes</Button>
            </Link>
            <Link href="/outreach">
              <Button>Outreach</Button>
            </Link>
            <Button
              variant="danger"
              onClick={() => {
                deleteDeal(deal.id);
                window.location.href = "/deals";
              }}
            >
              Delete
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Timeline" description="Channel activity" />
          <div className="divide-y divide-zinc-100">
            {deal.timeline.map((e) => (
              <div key={e.id} className="flex gap-3 px-4 py-3">
                <ChannelBadge channel={e.channel} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{e.title}</div>
                  {e.detail ? (
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {e.detail}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {new Date(e.at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Parties" />
            <div className="space-y-2 px-4 py-3">
              {deal.parties.map((p, i) => (
                <div key={i} className="text-sm">
                  <Badge>{p.role}</Badge>{" "}
                  <span className="font-medium">{p.name}</span>
                  {p.email ? (
                    <div className="text-xs text-zinc-500">{p.email}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Requirement" />
            <div className="space-y-1 px-4 py-3 text-sm">
              {deal.requirement ? (
                <>
                  <div>
                    <span className="text-zinc-500">Category:</span>{" "}
                    {deal.requirement.productCategory}
                  </div>
                  <div>
                    <span className="text-zinc-500">Target cost:</span>{" "}
                    {deal.requirement.targetFactoryCost != null
                      ? `$${deal.requirement.targetFactoryCost}`
                      : "—"}
                  </div>
                  <div>
                    <span className="text-zinc-500">Retail:</span>{" "}
                    {deal.requirement.targetRetailPrice != null
                      ? `$${deal.requirement.targetRetailPrice}`
                      : "—"}
                  </div>
                  <div>
                    <span className="text-zinc-500">Confidence:</span>{" "}
                    {deal.requirement.confidence != null
                      ? `${Math.round(deal.requirement.confidence * 100)}%`
                      : "—"}
                  </div>
                </>
              ) : (
                <p className="text-zinc-500">Not extracted yet</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Documents" />
            <div className="space-y-2 px-4 py-3 text-sm">
              {deal.documents.length === 0 ? (
                <p className="text-zinc-500">None</p>
              ) : (
                deal.documents.map((doc) => (
                  <div key={doc.id} className="flex justify-between gap-2">
                    <span>{doc.name}</span>
                    <Badge>{doc.type}</Badge>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Outreach" />
            <div className="space-y-2 px-4 py-3 text-sm">
              {deal.outreach.length === 0 ? (
                <p className="text-zinc-500">None enrolled</p>
              ) : (
                deal.outreach.map((o) => (
                  <div key={o.id}>
                    <div className="font-medium">{o.factoryName}</div>
                    <div className="text-xs text-zinc-500">
                      {o.status}
                      {o.disposition ? ` · ${o.disposition}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
