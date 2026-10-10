#!/usr/bin/env node
/**
 * Apply processed_deals schema to Neon.
 *   npm run db:migrate
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run vercel env pull, then retry.");
  process.exit(1);
}

const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS processed_deals (
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
  commercial_model TEXT
)
`;
await sql`CREATE INDEX IF NOT EXISTS processed_deals_stage ON processed_deals (primary_stage)`;
await sql`CREATE INDEX IF NOT EXISTS processed_deals_status ON processed_deals (status)`;
await sql`CREATE INDEX IF NOT EXISTS processed_deals_date_end ON processed_deals (date_end DESC)`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS input_tokens INTEGER`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS output_tokens INTEGER`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS commercial_model TEXT`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS evidence_json JSONB`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS document_name TEXT`;
await sql`ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS document_url TEXT`;
await sql`CREATE INDEX IF NOT EXISTS processed_deals_commercial_model ON processed_deals (commercial_model)`;
await sql`
  CREATE TABLE IF NOT EXISTS ingest_progress (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const [{ count }] = await sql`SELECT count(*)::int AS count FROM processed_deals`;
console.log(`Neon schema ready (${count} processed deals)`);
