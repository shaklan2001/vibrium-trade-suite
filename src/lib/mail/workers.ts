import { vibriumFetch } from "@/lib/vibrium/auth";
import { getVibriumConfig } from "@/lib/vibrium/config";

/** Vibrium worker executions — same API surface process_deals.py uses. */

function customerUrl(path: string) {
  const { apiBaseUrl, customerId } = getVibriumConfig();
  return `${apiBaseUrl}/v1/customers/${customerId}/${path.replace(/^\//, "")}`;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await vibriumFetch(customerUrl(path), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

export type Execution = {
  execution_id?: string;
  id?: string;
  status?: string;
  result?: unknown;
  output?: unknown;
  error?: unknown;
  message?: string;
  usage?: { combined?: { input_tokens?: number; output_tokens?: number } };
  usage_by_model?: Record<
    string,
    { input_tokens?: number; output_tokens?: number; cached_tokens?: number }
  >;
};

export const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);

export async function startExecution(agentId: string, input: Record<string, unknown>) {
  const started = await api<Execution>("POST", "agent-executions", {
    agent_id: agentId,
    input,
  });
  const id = started.execution_id || started.id;
  if (!id) throw new Error(`no execution_id in ${JSON.stringify(started).slice(0, 200)}`);
  return id;
}

export function getExecution(executionId: string) {
  return api<Execution>("GET", `agent-executions/${executionId}`);
}

export function executionResult(ex: Execution): Record<string, unknown> | null {
  const payload = ex.result ?? ex.output;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

// USD per 1M tokens (mirrors RATES_PER_MILLION in process_deals.py).
const RATES: Record<string, { input: number; output: number; cached: number }> = {
  "openai/gpt-4.1": { input: 2.0, output: 8.0, cached: 0.5 },
  "gemini/gemini-2.5-flash": { input: 0.15, output: 0.6, cached: 0.0375 },
};

function ratesFor(model: string) {
  if (RATES[model]) return RATES[model];
  const lower = model.toLowerCase();
  if (lower.includes("gpt-4.1")) return RATES["openai/gpt-4.1"];
  if (lower.includes("gemini")) return RATES["gemini/gemini-2.5-flash"];
  return null;
}

export function executionCost(ex: Execution | null) {
  let usd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const byModel = ex?.usage_by_model || {};
  if (Object.keys(byModel).length) {
    for (const [model, block] of Object.entries(byModel)) {
      const inp = Number(block?.input_tokens || 0);
      const out = Number(block?.output_tokens || 0);
      const cached = Math.min(inp, Number(block?.cached_tokens || 0));
      inputTokens += inp;
      outputTokens += out;
      const r = ratesFor(model);
      if (r) usd += ((inp - cached) * r.input + cached * r.cached + out * r.output) / 1e6;
    }
  } else {
    inputTokens = Number(ex?.usage?.combined?.input_tokens || 0);
    outputTokens = Number(ex?.usage?.combined?.output_tokens || 0);
    const r = RATES["openai/gpt-4.1"]!;
    usd = (inputTokens * r.input + outputTokens * r.output) / 1e6;
  }
  return { usd: Math.round(usd * 1e6) / 1e6, inputTokens, outputTokens };
}
