import { getSql } from "@/lib/db";
import { invokeTradeSuiteRds, isRdsProxyEnabled } from "@/lib/rdsProxy";
import type { ProcessedDealRow } from "@/lib/trade/processedDealMapper";
import type {
  MailConnectionRow,
  MailConnectionStats,
  MailDealJob,
  MailMessageSummary,
  StoredMailMessage,
} from "./types";

/**
 * Persistence for live mailbox sync. Two backends, same contract:
 *  - rds-proxy: actions on the trade-suite-rds-proxy Lambda (schema trade_suite)
 *  - Neon: direct SQL via DATABASE_URL
 * Tables: mail_connections, mail_messages, mail_deal_jobs (+ existing processed_deals).
 */

export type ProcessedDealUpsert = {
  id: string;
  po_numbers: string[];
  subject: string | null;
  primary_stage: string | null;
  slot: string | null;
  agent_id: string | null;
  execution_id: string | null;
  status: string;
  summary: string | null;
  confidence: number | null;
  date_start: string | null;
  date_end: string | null;
  message_count: number;
  doc_count: number;
  parties_json: Record<string, string[]>;
  result_json: unknown;
  error: string | null;
  processed_at: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  commercial_model: string;
  evidence_json: unknown;
  document_name: string | null;
  document_url: string | null;
};

export type JobUpdate = Partial<
  Pick<
    MailDealJob,
    | "status"
    | "dirty"
    | "execution_id"
    | "agent_id"
    | "slot"
    | "pack_json"
    | "attempts"
    | "last_error"
    | "started_at"
  >
>;

export interface MailStore {
  listConnections(): Promise<MailConnectionRow[]>;
  getConnection(id: string): Promise<MailConnectionRow | null>;
  saveConnection(row: MailConnectionRow): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  /** Atomic per-connection sync lock; true when acquired. */
  acquireLock(id: string, seconds: number): Promise<boolean>;
  releaseLock(id: string): Promise<void>;
  knownMessageIds(connectionId: string, ids: string[]): Promise<string[]>;
  insertMessages(rows: StoredMailMessage[]): Promise<void>;
  /** internet Message-ID → deal_key, across every connection. */
  dealKeysForMessageIds(ids: string[]): Promise<Record<string, string>>;
  messagesForDeal(dealKey: string, limit: number): Promise<StoredMailMessage[]>;
  recentMessages(opts: {
    connectionId?: string;
    limit: number;
  }): Promise<MailMessageSummary[]>;
  connectionStats(): Promise<Record<string, MailConnectionStats>>;
  markJobsDirty(dealKeys: string[]): Promise<void>;
  claimJobs(limit: number): Promise<MailDealJob[]>;
  runningJobs(limit: number): Promise<MailDealJob[]>;
  jobCounts(): Promise<Record<string, number>>;
  updateJob(dealKey: string, update: JobUpdate): Promise<void>;
  getProcessedDeal(id: string): Promise<ProcessedDealRow | null>;
  upsertProcessedDeal(row: ProcessedDealUpsert): Promise<void>;
  /** Newest deals in the book (no evidence), for the agent inbox. */
  recentDeals(limit: number): Promise<ProcessedDealRow[]>;
}

/* ------------------------------------------------------------------ */
/* RDS proxy backend                                                   */
/* ------------------------------------------------------------------ */

async function rds<T>(action: string, payload: Record<string, unknown> = {}) {
  const res = await invokeTradeSuiteRds<T>({ action, ...payload });
  if (!res.success) throw new Error(res.error || `${action} failed`);
  return res.data as T;
}

const rdsStore: MailStore = {
  listConnections: () => rds<MailConnectionRow[]>("mail_list_connections"),
  async getConnection(id) {
    return (await rds<MailConnectionRow | null>("mail_get_connection", { id })) ?? null;
  },
  async saveConnection(row) {
    await rds("mail_save_connection", { row });
  },
  async deleteConnection(id) {
    await rds("mail_delete_connection", { id });
  },
  async acquireLock(id, seconds) {
    const data = await rds<{ acquired: boolean }>("mail_acquire_lock", {
      id,
      seconds,
    });
    return Boolean(data?.acquired);
  },
  async releaseLock(id) {
    await rds("mail_release_lock", { id });
  },
  async knownMessageIds(connectionId, ids) {
    if (!ids.length) return [];
    const out: string[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = await rds<string[]>("mail_known_ids", {
        connection_id: connectionId,
        ids: ids.slice(i, i + 500),
      });
      out.push(...(chunk || []));
    }
    return out;
  },
  async insertMessages(rows) {
    // Lambda payload cap is 6 MB; bodies are clipped to 20k chars.
    for (let i = 0; i < rows.length; i += 25) {
      await rds("mail_insert_messages", { rows: rows.slice(i, i + 25) });
    }
  },
  async dealKeysForMessageIds(ids) {
    if (!ids.length) return {};
    return (await rds<Record<string, string>>("mail_deal_keys", { ids })) || {};
  },
  async messagesForDeal(dealKey, limit) {
    return (
      (await rds<StoredMailMessage[]>("mail_messages_for_deal", {
        deal_key: dealKey,
        limit,
      })) || []
    );
  },
  async recentMessages({ connectionId, limit }) {
    return (
      (await rds<MailMessageSummary[]>("mail_recent_messages", {
        connection_id: connectionId,
        limit,
      })) || []
    );
  },
  async connectionStats() {
    return (
      (await rds<Record<string, MailConnectionStats>>("mail_connection_stats")) ||
      {}
    );
  },
  async markJobsDirty(dealKeys) {
    if (!dealKeys.length) return;
    await rds("mail_jobs_mark_dirty", { deal_keys: dealKeys });
  },
  async claimJobs(limit) {
    return (await rds<MailDealJob[]>("mail_jobs_claim", { limit })) || [];
  },
  async runningJobs(limit) {
    return (await rds<MailDealJob[]>("mail_jobs_running", { limit })) || [];
  },
  async jobCounts() {
    return (await rds<Record<string, number>>("mail_jobs_counts")) || {};
  },
  async updateJob(dealKey, update) {
    await rds("mail_job_update", { deal_key: dealKey, update });
  },
  async getProcessedDeal(id) {
    const res = await invokeTradeSuiteRds<ProcessedDealRow>({
      action: "get_evidence",
      id,
    });
    if (!res.success) {
      if (res.error === "Not found") return null;
      throw new Error(res.error || "get_evidence failed");
    }
    return res.data ?? null;
  },
  async upsertProcessedDeal(row) {
    await rds("upsert_deals", { rows: [row] });
  },
  async recentDeals(limit) {
    return (await rds<ProcessedDealRow[]>("list_deals", { limit })) || [];
  },
};

/* ------------------------------------------------------------------ */
/* Neon backend                                                        */
/* ------------------------------------------------------------------ */

const NEON_SCHEMA = [
  // Same shape as the Aurora table (infra/trade-suite-rds-proxy migrate) so a
  // brand-new Neon database works end to end without running the PST migrate.
  `CREATE TABLE IF NOT EXISTS processed_deals (
    id TEXT PRIMARY KEY,
    po_numbers JSONB NOT NULL DEFAULT '[]',
    subject TEXT,
    primary_stage TEXT,
    slot TEXT,
    agent_id TEXT,
    execution_id TEXT,
    status TEXT,
    summary TEXT,
    confidence DOUBLE PRECISION,
    date_start TIMESTAMPTZ,
    date_end TIMESTAMPTZ,
    message_count INTEGER,
    doc_count INTEGER,
    parties_json JSONB NOT NULL DEFAULT '{}',
    result_json JSONB,
    error TEXT,
    processed_at TIMESTAMPTZ,
    cost_usd DOUBLE PRECISION,
    input_tokens INTEGER,
    output_tokens INTEGER,
    commercial_model TEXT,
    evidence_json JSONB,
    document_name TEXT,
    document_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS mail_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    secret_enc TEXT NOT NULL,
    settings_json JSONB NOT NULL DEFAULT '{}',
    cursor_json JSONB NOT NULL DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    sync_lock_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS mail_messages (
    connection_id TEXT NOT NULL,
    provider_message_id TEXT NOT NULL,
    internet_message_id TEXT,
    in_reply_to TEXT,
    references_json JSONB NOT NULL DEFAULT '[]',
    deal_key TEXT,
    subject TEXT,
    from_email TEXT,
    from_name TEXT,
    to_text TEXT,
    cc_text TEXT,
    sent_at TIMESTAMPTZ,
    body_text TEXT,
    attachments_json JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, provider_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS mail_messages_internet_id ON mail_messages (internet_message_id)`,
  `CREATE INDEX IF NOT EXISTS mail_messages_deal_key ON mail_messages (deal_key)`,
  `CREATE INDEX IF NOT EXISTS mail_messages_created ON mail_messages (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS mail_deal_jobs (
    deal_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    dirty BOOLEAN NOT NULL DEFAULT true,
    execution_id TEXT,
    agent_id TEXT,
    slot TEXT,
    pack_json JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS mail_deal_jobs_status ON mail_deal_jobs (status, dirty)`,
];

let schemaReady: Promise<void> | null = null;

async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const sql = getSql();
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of NEON_SCHEMA) await sql.query(stmt);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
  const rows = await sql.query(text, params);
  return (Array.isArray(rows) ? rows : []) as T[];
}

const MESSAGE_COLS = `connection_id, provider_message_id, internet_message_id, in_reply_to,
  references_json, deal_key, subject, from_email, from_name, to_text, cc_text,
  sent_at, attachments_json, status, role, created_at`;

const JOB_COLS = `deal_key, status, dirty, execution_id, agent_id, slot, pack_json,
  attempts, last_error, started_at, updated_at`;

const neonStore: MailStore = {
  listConnections: () =>
    q<MailConnectionRow>(
      `SELECT * FROM mail_connections ORDER BY created_at ASC`,
    ),
  async getConnection(id) {
    const rows = await q<MailConnectionRow>(
      `SELECT * FROM mail_connections WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },
  async saveConnection(r) {
    await q(
      `INSERT INTO mail_connections (
        id, provider, email, display_name, status, secret_enc, settings_json,
        cursor_json, last_sync_at, last_error, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,now())
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        status = EXCLUDED.status,
        secret_enc = EXCLUDED.secret_enc,
        settings_json = EXCLUDED.settings_json,
        cursor_json = EXCLUDED.cursor_json,
        last_sync_at = EXCLUDED.last_sync_at,
        last_error = EXCLUDED.last_error,
        updated_at = now()`,
      [
        r.id,
        r.provider,
        r.email,
        r.display_name,
        r.status,
        r.secret_enc,
        JSON.stringify(r.settings_json || {}),
        JSON.stringify(r.cursor_json || {}),
        r.last_sync_at,
        r.last_error,
      ],
    );
  },
  async deleteConnection(id) {
    await q(`DELETE FROM mail_messages WHERE connection_id = $1`, [id]);
    await q(`DELETE FROM mail_connections WHERE id = $1`, [id]);
  },
  async acquireLock(id, seconds) {
    const rows = await q(
      `UPDATE mail_connections
         SET sync_lock_until = now() + ($2 || ' seconds')::interval
       WHERE id = $1
         AND (sync_lock_until IS NULL OR sync_lock_until < now())
       RETURNING id`,
      [id, String(seconds)],
    );
    return rows.length > 0;
  },
  async releaseLock(id) {
    await q(`UPDATE mail_connections SET sync_lock_until = NULL WHERE id = $1`, [
      id,
    ]);
  },
  async knownMessageIds(connectionId, ids) {
    if (!ids.length) return [];
    const rows = await q<{ provider_message_id: string }>(
      `SELECT provider_message_id FROM mail_messages
       WHERE connection_id = $1 AND provider_message_id = ANY($2::text[])`,
      [connectionId, ids],
    );
    return rows.map((r) => r.provider_message_id);
  },
  async insertMessages(rows) {
    for (const m of rows) {
      await q(
        `INSERT INTO mail_messages (
          connection_id, provider_message_id, internet_message_id, in_reply_to,
          references_json, deal_key, subject, from_email, from_name, to_text,
          cc_text, sent_at, body_text, attachments_json, status, role
        ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
        ON CONFLICT (connection_id, provider_message_id) DO NOTHING`,
        [
          m.connection_id,
          m.provider_message_id,
          m.internet_message_id,
          m.in_reply_to,
          JSON.stringify(m.references_json || []),
          m.deal_key,
          m.subject,
          m.from_email,
          m.from_name,
          m.to_text,
          m.cc_text,
          m.sent_at,
          m.body_text,
          JSON.stringify(m.attachments_json || []),
          m.status,
          m.role,
        ],
      );
    }
  },
  async dealKeysForMessageIds(ids) {
    if (!ids.length) return {};
    const rows = await q<{ internet_message_id: string; deal_key: string }>(
      `SELECT DISTINCT ON (internet_message_id) internet_message_id, deal_key
       FROM mail_messages
       WHERE internet_message_id = ANY($1::text[]) AND deal_key IS NOT NULL`,
      [ids],
    );
    return Object.fromEntries(rows.map((r) => [r.internet_message_id, r.deal_key]));
  },
  async messagesForDeal(dealKey, limit) {
    // Newest N, returned oldest → newest; duplicates across mailboxes collapse later.
    const rows = await q<StoredMailMessage>(
      `SELECT * FROM (
         SELECT ${MESSAGE_COLS}, body_text FROM mail_messages
         WHERE deal_key = $1 AND status = 'ingested'
         ORDER BY sent_at DESC NULLS LAST
         LIMIT $2
       ) t ORDER BY sent_at ASC NULLS FIRST`,
      [dealKey, limit],
    );
    return rows;
  },
  async recentMessages({ connectionId, limit }) {
    return q<MailMessageSummary>(
      `SELECT ${MESSAGE_COLS.split(",")
        .map((c) => `m.${c.trim()}`)
        .join(", ")},
              j.status AS job_status, j.last_error AS job_error
       FROM mail_messages m
       LEFT JOIN mail_deal_jobs j ON j.deal_key = m.deal_key
       WHERE ($1::text IS NULL OR m.connection_id = $1)
       ORDER BY m.sent_at DESC NULLS LAST
       LIMIT $2`,
      [connectionId ?? null, limit],
    );
  },
  async connectionStats() {
    const rows = await q<MailConnectionStats & { connection_id: string }>(
      `SELECT connection_id,
              count(*)::int AS messages,
              count(*) FILTER (WHERE status = 'ingested')::int AS ingested,
              count(*) FILTER (WHERE status = 'noise')::int AS noise,
              count(DISTINCT deal_key) FILTER (WHERE status = 'ingested')::int AS deals,
              max(sent_at) AS last_message_at
       FROM mail_messages GROUP BY connection_id`,
    );
    return Object.fromEntries(
      rows.map(({ connection_id, ...rest }) => [connection_id, rest]),
    );
  },
  async markJobsDirty(dealKeys) {
    if (!dealKeys.length) return;
    await q(
      `INSERT INTO mail_deal_jobs (deal_key, status, dirty, updated_at)
       SELECT k, 'pending', true, now() FROM unnest($1::text[]) AS k
       ON CONFLICT (deal_key) DO UPDATE SET dirty = true, updated_at = now()`,
      [dealKeys],
    );
  },
  async claimJobs(limit) {
    // Stale 'starting' rows (crashed run) become claimable again after 10 min.
    return q<MailDealJob>(
      `UPDATE mail_deal_jobs SET status = 'starting', dirty = false,
              started_at = now(), updated_at = now()
       WHERE deal_key IN (
         SELECT deal_key FROM mail_deal_jobs
         WHERE (dirty AND status NOT IN ('running', 'starting'))
            OR (status = 'starting' AND started_at < now() - interval '10 minutes')
         ORDER BY updated_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING ${JOB_COLS}`,
      [limit],
    );
  },
  runningJobs: (limit) =>
    q<MailDealJob>(
      `SELECT ${JOB_COLS} FROM mail_deal_jobs WHERE status = 'running'
       ORDER BY started_at ASC LIMIT $1`,
      [limit],
    ),
  async jobCounts() {
    const rows = await q<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM mail_deal_jobs GROUP BY status`,
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  },
  async updateJob(dealKey, u) {
    const sets: string[] = [];
    const params: unknown[] = [dealKey];
    const push = (col: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (u.status !== undefined) push("status", u.status);
    if (u.dirty !== undefined) push("dirty", u.dirty);
    if (u.execution_id !== undefined) push("execution_id", u.execution_id);
    if (u.agent_id !== undefined) push("agent_id", u.agent_id);
    if (u.slot !== undefined) push("slot", u.slot);
    if (u.pack_json !== undefined)
      push("pack_json", u.pack_json == null ? null : JSON.stringify(u.pack_json), "::jsonb");
    if (u.attempts !== undefined) push("attempts", u.attempts);
    if (u.last_error !== undefined) push("last_error", u.last_error);
    if (u.started_at !== undefined) push("started_at", u.started_at);
    if (!sets.length) return;
    await q(
      `UPDATE mail_deal_jobs SET ${sets.join(", ")}, updated_at = now() WHERE deal_key = $1`,
      params,
    );
  },
  async getProcessedDeal(id) {
    const rows = await q<ProcessedDealRow>(
      `SELECT id, po_numbers, subject, primary_stage, slot, agent_id, status,
              summary, confidence, date_start, date_end, message_count, doc_count,
              parties_json, error, processed_at, cost_usd, result_json,
              commercial_model, evidence_json, document_name, document_url
       FROM processed_deals WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },
  async upsertProcessedDeal(r) {
    await q(
      `INSERT INTO processed_deals (
        id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
        status, summary, confidence, date_start, date_end, message_count, doc_count,
        parties_json, result_json, error, processed_at, cost_usd, input_tokens,
        output_tokens, commercial_model, evidence_json, document_name, document_url
      ) VALUES (
        $1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,
        $17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25
      )
      ON CONFLICT (id) DO UPDATE SET
        po_numbers = EXCLUDED.po_numbers, subject = EXCLUDED.subject,
        primary_stage = EXCLUDED.primary_stage, slot = EXCLUDED.slot,
        agent_id = EXCLUDED.agent_id, execution_id = EXCLUDED.execution_id,
        status = EXCLUDED.status, summary = EXCLUDED.summary,
        confidence = EXCLUDED.confidence, date_start = EXCLUDED.date_start,
        date_end = EXCLUDED.date_end, message_count = EXCLUDED.message_count,
        doc_count = EXCLUDED.doc_count, parties_json = EXCLUDED.parties_json,
        result_json = EXCLUDED.result_json, error = EXCLUDED.error,
        processed_at = EXCLUDED.processed_at, cost_usd = EXCLUDED.cost_usd,
        input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
        commercial_model = EXCLUDED.commercial_model,
        evidence_json = EXCLUDED.evidence_json,
        document_name = EXCLUDED.document_name, document_url = EXCLUDED.document_url`,
      [
        r.id,
        JSON.stringify(r.po_numbers || []),
        r.subject,
        r.primary_stage,
        r.slot,
        r.agent_id,
        r.execution_id,
        r.status,
        r.summary,
        r.confidence,
        r.date_start,
        r.date_end,
        r.message_count,
        r.doc_count,
        JSON.stringify(r.parties_json || {}),
        r.result_json == null ? null : JSON.stringify(r.result_json),
        r.error,
        r.processed_at,
        r.cost_usd,
        r.input_tokens,
        r.output_tokens,
        r.commercial_model,
        r.evidence_json == null ? null : JSON.stringify(r.evidence_json),
        r.document_name,
        r.document_url,
      ],
    );
  },
  recentDeals: (limit) =>
    q<ProcessedDealRow>(
      `SELECT id, po_numbers, subject, primary_stage, slot, agent_id, status,
              summary, confidence, date_start, date_end, message_count, doc_count,
              parties_json, error, processed_at, cost_usd, result_json,
              commercial_model, document_name, document_url
       FROM processed_deals ORDER BY date_end DESC NULLS LAST LIMIT $1`,
      [limit],
    ),
};

export function mailStoreConfigured(): boolean {
  return isRdsProxyEnabled() || Boolean(process.env.DATABASE_URL);
}

export function getMailStore(): MailStore {
  if (isRdsProxyEnabled()) return rdsStore;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "No database configured — set TRADE_SUITE_DB_MODE=rds-proxy or DATABASE_URL",
    );
  }
  return neonStore;
}
