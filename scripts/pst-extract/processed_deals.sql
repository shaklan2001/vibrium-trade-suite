-- Postgres-shaped store for mailbox agent results.
-- Local runner also writes SQLite at data/pst_extract/relevant/processed.db
-- Apply on Neon:
--   npm run db:migrate

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
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS processed_deals_stage ON processed_deals (primary_stage);
CREATE INDEX IF NOT EXISTS processed_deals_status ON processed_deals (status);
CREATE INDEX IF NOT EXISTS processed_deals_date_end ON processed_deals (date_end DESC);
