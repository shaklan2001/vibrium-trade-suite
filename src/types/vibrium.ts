export type WorkerFieldFormat =
  | "text"
  | "document_url"
  | "image_url"
  | "audio_url"
  | "url";

export interface WorkerAgentModel {
  provider?: "openai" | "gemini" | "azure" | "bedrock";
  model?: string;
}

export interface WorkerAgentConfig {
  max_turns?: number;
  timeout_seconds?: number;
  resolution_model?: string;
  thinking_budget?: number;
}

export interface WorkerAgent {
  agent_id: string;
  bot_id?: string;
  bot_kind?: string;
  name?: string;
  persona?: string;
  task?: string;
  description?: string;
  model?: WorkerAgentModel;
  config?: WorkerAgentConfig;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface AgentExecution {
  execution_id: string;
  agent_id: string;
  status: ExecutionStatus;
  input?: Record<string, unknown>;
  /** Structured worker payload — API field name is `result` (not `output`). */
  result?: Record<string, unknown>;
  /** @deprecated Legacy alias; prefer `result`. */
  output?: Record<string, unknown>;
  error?: string;
  error_code?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
}

export interface VoiceBot {
  bot_id: string;
  name?: string;
  status?: string;
  channel?: string;
  description?: string;
}

export interface WorkflowMeta {
  workflow_id: string;
  name?: string;
  is_api_integrated?: boolean;
  status?: string;
}
