"use client";

import {
  vibriumDelete,
  vibriumGet,
  vibriumPatch,
  vibriumPost,
  pollUntil,
} from "./vibriumClient";
import type { AgentExecution, WorkerAgent } from "@/types/vibrium";

function unwrapAgent(data: unknown): WorkerAgent {
  if (data && typeof data === "object" && "agent" in data) {
    return (data as { agent: WorkerAgent }).agent;
  }
  return data as WorkerAgent;
}

export async function listAgents(botKind?: "worker") {
  const data = await vibriumGet<
    { agents?: WorkerAgent[] } | WorkerAgent[]
  >("/agents", botKind ? { bot_kind: botKind } : undefined);
  if (Array.isArray(data)) return data;
  return data?.agents || [];
}

export async function createAgent(body: Record<string, unknown>) {
  const data = await vibriumPost("/agents", body);
  return unwrapAgent(data);
}

export async function patchAgent(agentId: string, body: Record<string, unknown>) {
  const data = await vibriumPatch(`/agents/${encodeURIComponent(agentId)}`, body);
  return unwrapAgent(data);
}

export async function deleteAgent(agentId: string) {
  await vibriumDelete(`/agents/${encodeURIComponent(agentId)}`);
}

export async function submitExecution(
  agentId: string,
  input: Record<string, unknown>,
) {
  return vibriumPost<AgentExecution>("/agent-executions", {
    agent_id: agentId,
    input,
  });
}

export async function getExecution(executionId: string, includeLogs = false) {
  return vibriumGet<AgentExecution>(
    `/agent-executions/${encodeURIComponent(executionId)}`,
    includeLogs ? { include_logs: "true" } : undefined,
  );
}

export async function runWorkerAndWait(
  agentId: string,
  input: Record<string, unknown>,
  onStatus?: (ex: AgentExecution) => void,
) {
  const started = await submitExecution(agentId, input);
  onStatus?.(started);
  return pollUntil(
    async () => {
      const ex = await getExecution(started.execution_id);
      onStatus?.(ex);
      return ex;
    },
    (ex) =>
      ["completed", "failed", "cancelled", "timed_out"].includes(ex.status),
  );
}
