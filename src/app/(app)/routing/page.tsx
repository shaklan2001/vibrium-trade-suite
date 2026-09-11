"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Button,
  Card,
  CardHeader,
  Input,
  Label,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { createAgent, listAgents, patchAgent } from "@/services/agentsApi";
import { listVoiceBots, listWorkflows } from "@/services/channelsApi";
import {
  ALL_WORKER_SPECS,
  ARTWORK_APPROVAL_PERSONA,
  BUYER_SELECTION_PERSONA,
  FACTORY_OUTREACH_PERSONA,
  PAYMENT_REMINDER_PERSONA,
  PO_ACK_PERSONA,
  PRODUCTION_FOLLOWUP_PERSONA,
  SAILING_CONFIRM_PERSONA,
  SAMPLE_DISPATCH_PERSONA,
} from "@/lib/trade/agentSpecs";
import type { WorkerAgent, VoiceBot, WorkflowMeta } from "@/types/vibrium";
import type { AgentRoutingMap, WorkerSlot } from "@/types/trade";
import { WORKER_SLOTS } from "@/types/trade";

export default function RoutingPage() {
  const routing = useTradeStore((s) => s.routing);
  const setRouting = useTradeStore((s) => s.setRouting);
  const [draft, setDraft] = useState<AgentRoutingMap>(routing);
  const [agents, setAgents] = useState<WorkerAgent[]>([]);
  const [bots, setBots] = useState<VoiceBot[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<string>("");

  useEffect(() => {
    setDraft(routing);
  }, [routing]);

  async function refresh() {
    setBusy(true);
    try {
      const [a, b, w] = await Promise.all([
        listAgents("worker").catch(() => listAgents()),
        listVoiceBots(),
        listWorkflows(),
      ]);
      setAgents(a);
      setBots(b);
      setWorkflows(w);
      setHealth(
        b.length
          ? `OK · ${a.length} agents · ${b.length} voice bots · ${w.length} workflows`
          : `OK · ${a.length} agents · ${w.length} workflows · voice bots unavailable from Vibrium`,
      );
    } catch (e) {
      setHealth(e instanceof Error ? e.message : "Refresh failed");
      toast.error("Could not list Vibrium resources");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function provisionMissingWorkers() {
    setBusy(true);
    try {
      const next = { ...draft };
      let created = 0;
      for (const slot of WORKER_SLOTS) {
        if (next[slot]) continue;
        const spec = ALL_WORKER_SPECS[slot as keyof typeof ALL_WORKER_SPECS];
        if (!spec) continue;
        const agent = await createAgent(spec);
        next[slot] = agent.agent_id;
        created += 1;
      }
      setDraft(next);
      setRouting(next);
      toast.success(
        created
          ? `Created ${created} workers`
          : "All worker slots already have IDs",
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Provision failed");
    } finally {
      setBusy(false);
    }
  }

  async function upgradeAllWorkers() {
    setBusy(true);
    try {
      let n = 0;
      for (const slot of WORKER_SLOTS) {
        const id = draft[slot];
        const spec = ALL_WORKER_SPECS[slot as keyof typeof ALL_WORKER_SPECS];
        if (!id || !spec) continue;
        await patchAgent(id, spec);
        n += 1;
      }
      toast.success(`Upgraded ${n} workers`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upgrade failed");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    setRouting(draft);
    toast.success("Routing saved in this browser");
  }

  const workerFields = WORKER_SLOTS.map((key) => ({
    key: key as WorkerSlot,
    label: `Worker · ${key}`,
  }));

  const otherFields: { key: keyof AgentRoutingMap; label: string }[] = [
    { key: "factory_outreach", label: "Conversational · factory_outreach (VB*)" },
    {
      key: "buyer_selection_chase",
      label: "Conversational · buyer_selection_chase (VB*)",
    },
    { key: "ops_copilot", label: "Conversational · ops_copilot (VB*)" },
    { key: "wf_factory_outreach", label: "Workflow · wf_factory_outreach" },
    {
      key: "wf_buyer_selection_chase",
      label: "Workflow · wf_buyer_selection_chase",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Agent Routing"
        description="Bind each workflow step to a Vibrium worker — extractors, risk, priority, and daily brief."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh from org
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void upgradeAllWorkers()}
            >
              Upgrade all workers
            </Button>
            <Button
              disabled={busy}
              onClick={() => void provisionMissingWorkers()}
            >
              Provision missing
            </Button>
            <Button variant="secondary" onClick={save}>
              Save map
            </Button>
          </div>
        }
      />

      {health ? (
        <p className="mb-4 text-xs text-zinc-500">{health}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Worker slot map" />
          <div className="max-h-[36rem] space-y-3 overflow-auto p-4">
            {workerFields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                  placeholder="AA*"
                />
              </div>
            ))}
            {otherFields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                  placeholder="VB* / workflow"
                />
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Worker agents in org" />
            <div className="max-h-56 overflow-auto p-4 text-sm">
              {agents.length === 0 ? (
                <p className="text-zinc-500">None listed.</p>
              ) : (
                agents.map((a) => (
                  <div key={a.agent_id} className="mb-2">
                    <code className="text-xs">{a.agent_id}</code> {a.name}
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Voice / conversational bots" />
            <div className="max-h-40 overflow-auto p-4 text-sm">
              {bots.length === 0 ? (
                <p className="text-zinc-500">None listed.</p>
              ) : (
                bots.map((b) => (
                  <div key={b.bot_id} className="mb-2">
                    <code className="text-xs">{b.bot_id}</code> {b.name}
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Workflows" />
            <div className="max-h-32 overflow-auto p-4 text-sm">
              {workflows.length === 0 ? (
                <p className="text-zinc-500">None listed.</p>
              ) : (
                workflows.map((w) => (
                  <div key={w.workflow_id} className="mb-2">
                    <code className="text-xs">{w.workflow_id}</code> {w.name}
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card className="p-4 text-xs text-zinc-600 whitespace-pre-wrap">
            <strong>Conversational personas (create later in Quantum UI)</strong>
            {"\n\n"}Factory:{"\n"}
            {FACTORY_OUTREACH_PERSONA}
            {"\n\n"}Buyer:{"\n"}
            {BUYER_SELECTION_PERSONA}
            {"\n\n"}Artwork:{"\n"}
            {ARTWORK_APPROVAL_PERSONA}
            {"\n\n"}Samples:{"\n"}
            {SAMPLE_DISPATCH_PERSONA}
            {"\n\n"}PO ack:{"\n"}
            {PO_ACK_PERSONA}
            {"\n\n"}Production:{"\n"}
            {PRODUCTION_FOLLOWUP_PERSONA}
            {"\n\n"}Sailing:{"\n"}
            {SAILING_CONFIRM_PERSONA}
            {"\n\n"}Payment:{"\n"}
            {PAYMENT_REMINDER_PERSONA}
          </Card>
        </div>
      </div>
    </div>
  );
}
