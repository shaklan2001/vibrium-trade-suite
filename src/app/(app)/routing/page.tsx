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
import { createAgent, listAgents } from "@/services/agentsApi";
import { listVoiceBots, listWorkflows } from "@/services/channelsApi";
import {
  BUYER_SELECTION_PERSONA,
  FACTORY_OUTREACH_PERSONA,
  QUOTE_NORMALIZER_SPEC,
  REQUIREMENT_EXTRACTOR_SPEC,
} from "@/lib/trade/agentSpecs";
import type { WorkerAgent, VoiceBot, WorkflowMeta } from "@/types/vibrium";
import type { AgentRoutingMap } from "@/types/trade";

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
        `OK · ${a.length} agents · ${b.length} voice bots · ${w.length} workflows`,
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

  async function provisionWorkers() {
    setBusy(true);
    try {
      const req = await createAgent(REQUIREMENT_EXTRACTOR_SPEC);
      const q = await createAgent(QUOTE_NORMALIZER_SPEC);
      const next = {
        ...draft,
        requirement_extractor: req.agent_id,
        quote_normalizer: q.agent_id,
      };
      setDraft(next);
      setRouting(next);
      toast.success(
        `Workers created: ${req.agent_id} / ${q.agent_id}`,
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Provision failed");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    setRouting(draft);
    toast.success("Routing saved in this browser");
  }

  const fields: { key: keyof AgentRoutingMap; label: string }[] = [
    { key: "requirement_extractor", label: "Worker · requirement_extractor" },
    { key: "quote_normalizer", label: "Worker · quote_normalizer" },
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
        description="Map Phase A slots to existing Vibrium worker agents, voice/WhatsApp bots, and api-integrated workflows. IDs persist in this browser."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
              Refresh from org
            </Button>
            <Button disabled={busy} onClick={() => void provisionWorkers()}>
              Provision worker agents
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
          <CardHeader title="Slot map" />
          <div className="space-y-3 p-4">
            {fields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                  placeholder="AA* / VB* / zw*"
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
                <p className="text-zinc-500">None listed (or empty org).</p>
              ) : (
                agents.map((a) => (
                  <div key={a.agent_id} className="mb-2">
                    <code className="text-xs">{a.agent_id}</code>{" "}
                    {a.name}{" "}
                    <span className="text-zinc-400">{a.bot_kind}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Voice / conversational bots" />
            <div className="max-h-56 overflow-auto p-4 text-sm">
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
            <div className="max-h-40 overflow-auto p-4 text-sm">
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
            <strong>Suggested conversational personas</strong>
            {"\n\n"}Factory outreach:{"\n"}
            {FACTORY_OUTREACH_PERSONA}
            {"\n\n"}Buyer chase:{"\n"}
            {BUYER_SELECTION_PERSONA}
          </Card>
        </div>
      </div>
    </div>
  );
}
