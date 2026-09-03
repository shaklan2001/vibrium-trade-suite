"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Label,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { addLead } from "@/services/channelsApi";
import { EmailThreadsPanel } from "@/components/shared/email-threads-panel";
import type { Channel } from "@/types/trade";

export default function OutreachPage() {
  const deals = useTradeStore((s) => s.deals);
  const routing = useTradeStore((s) => s.routing);
  const addOutreach = useTradeStore((s) => s.addOutreach);
  const updateOutreach = useTradeStore((s) => s.updateOutreach);
  const addTimeline = useTradeStore((s) => s.addTimeline);

  const [dealId, setDealId] = useState(deals[0]?.id || "");
  const deal = useMemo(
    () => deals.find((d) => d.id === dealId),
    [deals, dealId],
  );

  const [factoryName, setFactoryName] = useState("Y.K. Industries");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("yash@ykindustries.co.in");
  const [countryCode, setCountryCode] = useState("+91");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [mode, setMode] = useState<"factory" | "buyer">("factory");
  const [busy, setBusy] = useState(false);

  async function enroll() {
    if (!deal) {
      toast.error("Select a deal");
      return;
    }
    const workflowId =
      mode === "factory"
        ? routing.wf_factory_outreach
        : routing.wf_buyer_selection_chase;

    setBusy(true);
    try {
      let contactId: string | undefined;
      if (workflowId && (phone || email)) {
        const brief = deal.requirement
          ? `${deal.requirement.productCategory} · target <$${deal.requirement.targetFactoryCost ?? "?"} · ${deal.requirement.summary || ""}`
          : deal.title;

        const res = (await addLead({
          workflow_id: workflowId,
          first_name: factoryName.split(" ")[0] || "Contact",
          last_name: factoryName.split(" ").slice(1).join(" ") || "Factory",
          phone: phone || undefined,
          country_code: countryCode,
          email: email || undefined,
          deal_id: deal.id,
          product_brief: brief,
          bot_id:
            mode === "factory"
              ? routing.factory_outreach
              : routing.buyer_selection_chase,
        })) as { contact_id?: string; contactId?: string };

        contactId = res.contact_id || res.contactId;
        toast.success("Enrolled in Vibrium workflow");
      } else {
        toast.message(
          workflowId
            ? "Missing phone/email — recorded locally only"
            : "No workflow ID — recorded locally (configure Agent Routing)",
        );
      }

      addOutreach(deal.id, {
        factoryName: mode === "factory" ? factoryName : "Buyer chase",
        contactId,
        workflowId,
        channel,
        status: "enrolled",
      });
      addTimeline(deal.id, {
        channel,
        title:
          mode === "factory"
            ? `Factory outreach started · ${factoryName}`
            : "Buyer selection chase started",
        detail: workflowId
          ? `workflow ${workflowId}`
          : "Local enrollment (no workflow)",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enroll failed");
      addOutreach(deal.id, {
        factoryName,
        workflowId,
        channel,
        status: "EscalateToHuman",
        disposition: e instanceof Error ? e.message : "enroll_failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Outreach"
        description="Enroll factory outreach or buyer selection chase via existing Vibrium workflows (add-lead)."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Enroll contact" />
          <div className="space-y-3 p-4">
            <div>
              <Label>Deal</Label>
              <select
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              >
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                variant={mode === "factory" ? "primary" : "secondary"}
                onClick={() => setMode("factory")}
              >
                Factory outreach
              </Button>
              <Button
                variant={mode === "buyer" ? "primary" : "secondary"}
                onClick={() => setMode("buyer")}
              >
                Buyer chase
              </Button>
            </div>
            {mode === "factory" ? (
              <div>
                <Label>Factory name</Label>
                <Input
                  value={factoryName}
                  onChange={(e) => setFactoryName(e.target.value)}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Country</Label>
                <Input
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Label>Phone</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210"
                />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>Preferred channel</Label>
              <select
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="voice">Voice</option>
              </select>
            </div>
            <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
              Workflow:{" "}
              <code>
                {mode === "factory"
                  ? routing.wf_factory_outreach || "(not set)"
                  : routing.wf_buyer_selection_chase || "(not set)"}
              </code>
              <br />
              Bot:{" "}
              <code>
                {mode === "factory"
                  ? routing.factory_outreach || "(not set)"
                  : routing.buyer_selection_chase || "(not set)"}
              </code>
            </div>
            <Button disabled={busy || !dealId} onClick={() => void enroll()}>
              Enroll
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Enrollments" description="Update dispositions manually if workflow callbacks are not wired" />
          <div className="divide-y divide-zinc-100">
            {!deal || deal.outreach.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No enrollments yet.</p>
            ) : (
              deal.outreach.map((o) => (
                <div key={o.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{o.factoryName}</div>
                    <Badge>{o.status}</Badge>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {o.channel}
                    {o.workflowId ? ` · ${o.workflowId}` : ""}
                    {o.contactId ? ` · contact ${o.contactId}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        "QuotePromised",
                        "NeedClarification",
                        "Declined",
                        "Selected",
                        "NeedMoreTime",
                        "EscalateToHuman",
                      ] as const
                    ).map((d) => (
                      <Button
                        key={d}
                        variant="ghost"
                        className="!px-2 !py-1 text-xs"
                        onClick={() => {
                          updateOutreach(deal.id, o.id, {
                            status: d,
                            disposition: d,
                          });
                          addTimeline(deal.id, {
                            channel: o.channel,
                            title: `Disposition: ${d}`,
                            detail: o.factoryName,
                          });
                        }}
                      >
                        {d}
                      </Button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <EmailThreadsPanel />
      </div>
    </div>
  );
}
