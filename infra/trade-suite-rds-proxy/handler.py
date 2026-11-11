"""
trade-suite-rds-proxy — VPC Lambda for Vibrium Trade Suite Aurora access.

Mirrors vibrium-backend rds-query-proxy connection style (DB_HOST/DB_PORT/…)
but is hard-scoped to schema `trade_suite` only. It never reads/writes
public (prod) tables in vibriumdb.

Actions:
  migrate              Create schema + tables (idempotent)
  list_deals           SELECT processed_deals (+ optional stage filter)
  get_evidence         SELECT one row by id (full evidence)
  upsert_deals         Bulk upsert rows (for restore / ingest)
  health               SELECT current_database(), current_schema(), counts
  mail_*               Live mailbox sync (connections, messages, deal jobs) —
                       see MAIL_ACTIONS and src/lib/mail/store.ts
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pg8000.native

logger = logging.getLogger("trade-suite-rds-proxy")
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

DB_HOST = os.environ["DB_HOST"]
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]
# Hard isolation — not overridable to public
SCHEMA = "trade_suite"
IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

_conn: pg8000.native.Connection | None = None


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, (bytes, memoryview)):
        return bytes(obj).decode("utf-8", errors="replace")
    raise TypeError(f"Not JSON serializable: {type(obj)}")


def _ok(data: Any = None, **extra: Any) -> dict:
    body = {"success": True, **extra}
    if data is not None:
        body["data"] = data
    return json.loads(json.dumps(body, default=_json_default))


def _err(message: str) -> dict:
    return {"success": False, "error": message}


def _connect() -> pg8000.native.Connection:
    global _conn
    if _conn is not None:
        try:
            _conn.run("SELECT 1")
            return _conn
        except Exception:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = None
    _conn = pg8000.native.Connection(
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        timeout=15,
    )
    # Pin session to trade_suite — never touch public/prod tables accidentally
    _conn.run(f"SET search_path TO {SCHEMA}, public")
    _conn.run(f"SET statement_timeout TO '30s'")
    return _conn


def _migrate(conn: pg8000.native.Connection) -> dict:
    conn.run(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    conn.run(f"SET search_path TO {SCHEMA}")
    conn.run(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.processed_deals (
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
          parties_json JSONB NOT NULL DEFAULT '{{}}',
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
        )
        """
    )
    conn.run(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.ingest_progress (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    _migrate_mail(conn)
    for stmt in (
        f"CREATE INDEX IF NOT EXISTS processed_deals_stage ON {SCHEMA}.processed_deals (primary_stage)",
        f"CREATE INDEX IF NOT EXISTS processed_deals_status ON {SCHEMA}.processed_deals (status)",
        f"CREATE INDEX IF NOT EXISTS processed_deals_date_end ON {SCHEMA}.processed_deals (date_end DESC)",
        f"CREATE INDEX IF NOT EXISTS processed_deals_commercial_model ON {SCHEMA}.processed_deals (commercial_model)",
    ):
        conn.run(stmt)
    count = conn.run(f"SELECT count(*)::int FROM {SCHEMA}.processed_deals")[0][0]
    return _ok(
        {
            "schema": SCHEMA,
            "tables": [
                "processed_deals",
                "ingest_progress",
                "mail_connections",
                "mail_messages",
                "mail_deal_jobs",
            ],
            "processed_deals_count": count,
        }
    )


def _health(conn: pg8000.native.Connection) -> dict:
    rows = conn.run(
        """
        SELECT current_database(), current_user,
               current_setting('search_path'),
               (SELECT count(*)::int FROM trade_suite.processed_deals)
        """
    )
    db, user, path, n = rows[0]
    return _ok(
        {
            "database": db,
            "user": user,
            "search_path": path,
            "schema": SCHEMA,
            "processed_deals": n,
        }
    )


# Lightweight participant/header blob for client search (no message bodies).
_SEARCH_TEXT_SQL = f"""
LEFT(
  coalesce(subject, '') || ' ' ||
  coalesce(parties_json::text, '') || ' ' ||
  coalesce(po_numbers::text, '') || ' ' ||
  coalesce(summary, '') || ' ' ||
  coalesce(
    (
      SELECT string_agg(
        coalesce(m->>'from','') || ' ' ||
        coalesce(m->>'to','') || ' ' ||
        coalesce(m->>'cc','') || ' ' ||
        coalesce(m->>'bcc','') || ' ' ||
        coalesce(m->>'from_name','') || ' ' ||
        coalesce(m->>'subject',''),
        ' '
      )
      FROM jsonb_array_elements(
        CASE
          WHEN evidence_json IS NOT NULL
           AND jsonb_typeof(evidence_json->'messages') = 'array'
          THEN evidence_json->'messages'
          ELSE '[]'::jsonb
        END
      ) AS m
    ),
    ''
  ),
  12000
)
"""


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _list_deals(conn: pg8000.native.Connection, payload: dict) -> dict:
    stage = (payload.get("stage") or "").strip()
    q = (payload.get("q") or "").strip()[:120]
    # Page size capped for Lambda response size; callers should paginate via offset.
    limit = min(max(int(payload.get("limit") or 400), 1), 500)
    offset = max(int(payload.get("offset") or 0), 0)
    if stage and not IDENTIFIER_RE.match(stage):
        return _err("invalid stage")
    # list_deals omits evidence_json (can be multi-MB) — fetch via get_evidence.
    # search_text carries party + mail header tokens (e.g. kalpana@snspl.in).
    where_parts: list[str] = []
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    ids = _str_list(payload.get("ids"), 200)
    if ids:
        where_parts.append("id = ANY(CAST(:ids AS text[]))")
        params["ids"] = ids
    connection_ids = _str_list(payload.get("connection_ids"), 100)
    scope_sql = ""
    scope_params: dict[str, Any] = {}
    if connection_ids:
        # Deals built from these connected mailboxes (Mailbox book source filter).
        scope_sql = (
            f"id IN (SELECT DISTINCT deal_key FROM {SCHEMA}.mail_messages "
            "WHERE connection_id = ANY(CAST(:connection_ids AS text[])) AND deal_key IS NOT NULL)"
        )
        where_parts.append(scope_sql)
        params["connection_ids"] = connection_ids
        scope_params["connection_ids"] = connection_ids
    # Counts follow the source filter so the tabs add up.
    scope_where = f"WHERE {scope_sql}" if scope_sql else ""
    scope_and = f"AND {scope_sql}" if scope_sql else ""
    if stage:
        where_parts.append("primary_stage = :stage")
        params["stage"] = stage
    if q:
        like = f"%{_escape_like(q)}%"
        params["like"] = like
        where_parts.append(
            "("
            "subject ILIKE :like ESCAPE '\\' OR "
            "parties_json::text ILIKE :like ESCAPE '\\' OR "
            "po_numbers::text ILIKE :like ESCAPE '\\' OR "
            "coalesce(summary, '') ILIKE :like ESCAPE '\\' OR "
            "evidence_json::text ILIKE :like ESCAPE '\\'"
            ")"
        )
    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    rows = conn.run(
        f"""
        SELECT id, po_numbers, subject, primary_stage, slot, agent_id,
               status, summary, confidence, date_start, date_end,
               message_count, doc_count, parties_json, error, processed_at,
               cost_usd, input_tokens, output_tokens, result_json,
               commercial_model, document_name, document_url,
               (evidence_json IS NOT NULL) AS has_evidence,
               {_SEARCH_TEXT_SQL} AS search_text
        FROM {SCHEMA}.processed_deals
        {where_sql}
        ORDER BY date_end DESC NULLS LAST
        LIMIT :limit OFFSET :offset
        """,
        **params,
    )
    cols = [
        "id",
        "po_numbers",
        "subject",
        "primary_stage",
        "slot",
        "agent_id",
        "status",
        "summary",
        "confidence",
        "date_start",
        "date_end",
        "message_count",
        "doc_count",
        "parties_json",
        "error",
        "processed_at",
        "cost_usd",
        "input_tokens",
        "output_tokens",
        "result_json",
        "commercial_model",
        "document_name",
        "document_url",
        "has_evidence",
        "search_text",
    ]
    deals = [dict(zip(cols, r)) for r in rows]
    stage_rows = conn.run(
        f"""
        SELECT primary_stage, count(*)::int
        FROM {SCHEMA}.processed_deals {scope_where} GROUP BY primary_stage
        """,
        **scope_params,
    )
    status_rows = conn.run(
        f"""
        SELECT status, count(*)::int
        FROM {SCHEMA}.processed_deals {scope_where} GROUP BY status
        """,
        **scope_params,
    )
    model_rows = conn.run(
        f"""
        SELECT commercial_model, count(*)::int
        FROM {SCHEMA}.processed_deals
        WHERE status = 'completed' {scope_and}
        GROUP BY commercial_model
        """,
        **scope_params,
    )
    total = conn.run(f"SELECT count(*)::int FROM {SCHEMA}.processed_deals {scope_where}", **scope_params)[0][0]
    spend = conn.run(
        f"SELECT coalesce(sum(cost_usd), 0)::float8 FROM {SCHEMA}.processed_deals {scope_where}",
        **scope_params,
    )[0][0]
    return _ok(
        deals,
        counts={
            "total": total,
            "byStage": {str(s or "unknown"): c for s, c in stage_rows},
            "byStatus": {str(s or "unknown"): c for s, c in status_rows},
            "byModel": {
                str(m or "agency_commission"): c for m, c in model_rows
            },
            "spendUsd": float(spend or 0),
        },
    )


def _get_evidence(conn: pg8000.native.Connection, payload: dict) -> dict:
    deal_id = (payload.get("id") or "").strip()
    if not deal_id:
        return _err("id required")
    rows = conn.run(
        f"""
        SELECT id, po_numbers, subject, primary_stage, slot, agent_id,
               status, summary, confidence, date_start, date_end,
               message_count, doc_count, parties_json, error, processed_at,
               cost_usd, result_json, commercial_model, evidence_json,
               document_name, document_url
        FROM {SCHEMA}.processed_deals
        WHERE id = :id
        LIMIT 1
        """,
        id=deal_id,
    )
    if not rows:
        return _err("Not found")
    cols = [
        "id",
        "po_numbers",
        "subject",
        "primary_stage",
        "slot",
        "agent_id",
        "status",
        "summary",
        "confidence",
        "date_start",
        "date_end",
        "message_count",
        "doc_count",
        "parties_json",
        "error",
        "processed_at",
        "cost_usd",
        "result_json",
        "commercial_model",
        "evidence_json",
        "document_name",
        "document_url",
    ]
    return _ok(dict(zip(cols, rows[0])))


def _upsert_deals(conn: pg8000.native.Connection, payload: dict) -> dict:
    rows = payload.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return _err("rows required")
    if len(rows) > 100:
        return _err("max 100 rows per invoke")
    upserted = 0
    for row in rows:
        rid = row.get("id")
        if not rid:
            continue
        conn.run(
            f"""
            INSERT INTO {SCHEMA}.processed_deals (
              id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
              status, summary, confidence, date_start, date_end, message_count, doc_count,
              parties_json, result_json, error, processed_at, cost_usd, input_tokens,
              output_tokens, commercial_model, evidence_json, document_name, document_url
            ) VALUES (
              :id, CAST(:po AS jsonb), :subject, :primary_stage, :slot, :agent_id, :execution_id,
              :status, :summary, :confidence, :date_start, :date_end, :message_count, :doc_count,
              CAST(:parties AS jsonb), CAST(:result AS jsonb), :error, :processed_at, :cost_usd,
              :input_tokens, :output_tokens, :commercial_model, CAST(:evidence AS jsonb),
              :document_name, :document_url
            )
            ON CONFLICT (id) DO UPDATE SET
              po_numbers = EXCLUDED.po_numbers,
              subject = EXCLUDED.subject,
              primary_stage = EXCLUDED.primary_stage,
              slot = EXCLUDED.slot,
              agent_id = EXCLUDED.agent_id,
              execution_id = EXCLUDED.execution_id,
              status = EXCLUDED.status,
              summary = EXCLUDED.summary,
              confidence = EXCLUDED.confidence,
              date_start = EXCLUDED.date_start,
              date_end = EXCLUDED.date_end,
              message_count = EXCLUDED.message_count,
              doc_count = EXCLUDED.doc_count,
              parties_json = EXCLUDED.parties_json,
              result_json = EXCLUDED.result_json,
              error = EXCLUDED.error,
              processed_at = EXCLUDED.processed_at,
              cost_usd = EXCLUDED.cost_usd,
              input_tokens = EXCLUDED.input_tokens,
              output_tokens = EXCLUDED.output_tokens,
              commercial_model = EXCLUDED.commercial_model,
              evidence_json = EXCLUDED.evidence_json,
              document_name = EXCLUDED.document_name,
              document_url = EXCLUDED.document_url
            """,
            id=rid,
            po=json.dumps(row.get("po_numbers") or []),
            subject=row.get("subject"),
            primary_stage=row.get("primary_stage"),
            slot=row.get("slot"),
            agent_id=row.get("agent_id"),
            execution_id=row.get("execution_id"),
            status=row.get("status"),
            summary=row.get("summary"),
            confidence=row.get("confidence"),
            date_start=row.get("date_start"),
            date_end=row.get("date_end"),
            message_count=row.get("message_count"),
            doc_count=row.get("doc_count"),
            parties=json.dumps(row.get("parties_json") or {}),
            result=json.dumps(row.get("result_json")) if row.get("result_json") is not None else None,
            error=row.get("error"),
            processed_at=row.get("processed_at"),
            cost_usd=row.get("cost_usd"),
            input_tokens=row.get("input_tokens"),
            output_tokens=row.get("output_tokens"),
            commercial_model=row.get("commercial_model"),
            evidence=json.dumps(row.get("evidence_json")) if row.get("evidence_json") is not None else None,
            document_name=row.get("document_name"),
            document_url=row.get("document_url"),
        )
        upserted += 1
    return _ok({"upserted": upserted})


# --------------------------------------------------------------------------
# Live mailbox connections (Gmail / Microsoft 365 / IMAP) — see src/lib/mail
# --------------------------------------------------------------------------

MAIL_MESSAGE_COLS = (
    "connection_id, provider_message_id, internet_message_id, in_reply_to, "
    "references_json, deal_key, subject, from_email, from_name, to_text, cc_text, "
    "sent_at, attachments_json, status, role, created_at"
)
MAIL_JOB_COLS = (
    "deal_key, status, dirty, execution_id, agent_id, slot, pack_json, "
    "attempts, last_error, started_at, updated_at"
)
JOB_UPDATE_FIELDS = {
    "status": "",
    "dirty": "",
    "execution_id": "",
    "agent_id": "",
    "slot": "",
    "pack_json": "jsonb",
    "attempts": "",
    "last_error": "",
    "started_at": "",
}


def _migrate_mail(conn: pg8000.native.Connection) -> None:
    for stmt in (
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.mail_connections (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          email TEXT NOT NULL,
          display_name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          secret_enc TEXT NOT NULL,
          settings_json JSONB NOT NULL DEFAULT '{{}}',
          cursor_json JSONB NOT NULL DEFAULT '{{}}',
          last_sync_at TIMESTAMPTZ,
          last_error TEXT,
          sync_lock_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.mail_messages (
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
        )
        """,
        f"CREATE INDEX IF NOT EXISTS mail_messages_internet_id ON {SCHEMA}.mail_messages (internet_message_id)",
        f"CREATE INDEX IF NOT EXISTS mail_messages_deal_key ON {SCHEMA}.mail_messages (deal_key)",
        f"CREATE INDEX IF NOT EXISTS mail_messages_created ON {SCHEMA}.mail_messages (created_at DESC)",
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.mail_deal_jobs (
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
        )
        """,
        f"CREATE INDEX IF NOT EXISTS mail_deal_jobs_status ON {SCHEMA}.mail_deal_jobs (status, dirty)",
        # Shared inbox: conversation grouping + folder, so the inbox reads from
        # the store instead of opening 15 IMAP sessions per page.
        f"ALTER TABLE {SCHEMA}.mail_messages ADD COLUMN IF NOT EXISTS thread_key TEXT",
        f"ALTER TABLE {SCHEMA}.mail_messages ADD COLUMN IF NOT EXISTS folder TEXT",
        # Same rule as threadKeyFor() in src/lib/mail/thread.ts.
        f"""
        UPDATE {SCHEMA}.mail_messages
        SET thread_key = COALESCE(
          NULLIF(btrim(regexp_replace(lower(regexp_replace(btrim(coalesce(subject, '')),
            '^((re|fw|fwd|aw|sv)\\s*:\\s*)+', '', 'i')), '\\s+', ' ', 'g')), ''),
          internet_message_id, provider_message_id)
        WHERE thread_key IS NULL
        """,
        f"""
        UPDATE {SCHEMA}.mail_messages
        SET folder = CASE WHEN provider_message_id ILIKE 'imap:INBOX:%' THEN 'inbox'
                          WHEN provider_message_id LIKE 'imap:%' THEN 'sent'
                          ELSE 'inbox' END
        WHERE folder IS NULL
        """,
        f"CREATE INDEX IF NOT EXISTS mail_messages_conn_sent ON {SCHEMA}.mail_messages (connection_id, sent_at DESC)",
        f"CREATE INDEX IF NOT EXISTS mail_messages_thread ON {SCHEMA}.mail_messages (thread_key, sent_at DESC)",
    ):
        conn.run(stmt)


def _rows(conn: pg8000.native.Connection, sql: str, **params: Any) -> list[dict]:
    rows = conn.run(sql, **params)
    cols = [c["name"] for c in (conn.columns or [])]
    return [dict(zip(cols, r)) for r in rows]


def _str_list(value: Any, limit: int = 2000) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v) for v in value[:limit] if v is not None]


def _mail_list_connections(conn, payload):
    return _ok(_rows(conn, f"SELECT * FROM {SCHEMA}.mail_connections ORDER BY created_at ASC"))


def _mail_get_connection(conn, payload):
    rows = _rows(
        conn, f"SELECT * FROM {SCHEMA}.mail_connections WHERE id = :id", id=payload.get("id")
    )
    return _ok(rows[0] if rows else None)


def _mail_save_connection(conn, payload):
    r = payload.get("row") or {}
    if not r.get("id") or not r.get("provider") or not r.get("email") or not r.get("secret_enc"):
        return _err("row.id, provider, email, secret_enc required")
    conn.run(
        f"""
        INSERT INTO {SCHEMA}.mail_connections (
          id, provider, email, display_name, status, secret_enc, settings_json,
          cursor_json, last_sync_at, last_error, updated_at
        ) VALUES (
          :id, :provider, :email, :display_name, :status, :secret_enc,
          CAST(:settings AS jsonb), CAST(:cursor AS jsonb), :last_sync_at, :last_error, now()
        )
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
          updated_at = now()
        """,
        id=r["id"],
        provider=r["provider"],
        email=r["email"],
        display_name=r.get("display_name"),
        status=r.get("status") or "active",
        secret_enc=r["secret_enc"],
        settings=json.dumps(r.get("settings_json") or {}),
        cursor=json.dumps(r.get("cursor_json") or {}),
        last_sync_at=r.get("last_sync_at"),
        last_error=r.get("last_error"),
    )
    return _ok({"saved": r["id"]})


def _mail_delete_connection(conn, payload):
    cid = payload.get("id")
    conn.run(f"DELETE FROM {SCHEMA}.mail_messages WHERE connection_id = :id", id=cid)
    conn.run(f"DELETE FROM {SCHEMA}.mail_connections WHERE id = :id", id=cid)
    return _ok({"deleted": cid})


def _mail_acquire_lock(conn, payload):
    seconds = min(max(int(payload.get("seconds") or 300), 30), 900)
    rows = conn.run(
        f"""
        UPDATE {SCHEMA}.mail_connections
           SET sync_lock_until = now() + make_interval(secs => :secs)
         WHERE id = :id AND (sync_lock_until IS NULL OR sync_lock_until < now())
        RETURNING id
        """,
        id=payload.get("id"),
        secs=seconds,
    )
    return _ok({"acquired": bool(rows)})


def _mail_release_lock(conn, payload):
    conn.run(
        f"UPDATE {SCHEMA}.mail_connections SET sync_lock_until = NULL WHERE id = :id",
        id=payload.get("id"),
    )
    return _ok({"released": True})


def _mail_known_ids(conn, payload):
    ids = _str_list(payload.get("ids"), 1000)
    if not ids:
        return _ok([])
    rows = conn.run(
        f"""
        SELECT provider_message_id FROM {SCHEMA}.mail_messages
        WHERE connection_id = :cid AND provider_message_id = ANY(CAST(:ids AS text[]))
        """,
        cid=payload.get("connection_id"),
        ids=ids,
    )
    return _ok([r[0] for r in rows])


def _mail_insert_messages(conn, payload):
    rows = payload.get("rows") or []
    if not isinstance(rows, list) or len(rows) > 100:
        return _err("rows must be a list of ≤ 100")
    inserted = 0
    for m in rows:
        if not m.get("connection_id") or not m.get("provider_message_id"):
            continue
        conn.run(
            f"""
            INSERT INTO {SCHEMA}.mail_messages (
              connection_id, provider_message_id, internet_message_id, in_reply_to,
              references_json, deal_key, subject, from_email, from_name, to_text,
              cc_text, sent_at, body_text, attachments_json, status, role,
              thread_key, folder
            ) VALUES (
              :cid, :pid, :iid, :irt, CAST(:refs AS jsonb), :deal_key, :subject,
              :from_email, :from_name, :to_text, :cc_text, :sent_at, :body_text,
              CAST(:atts AS jsonb), :status, :role, :thread_key, :folder
            )
            ON CONFLICT (connection_id, provider_message_id) DO NOTHING
            """,
            cid=m["connection_id"],
            pid=m["provider_message_id"],
            iid=m.get("internet_message_id"),
            irt=m.get("in_reply_to"),
            refs=json.dumps(m.get("references_json") or []),
            deal_key=m.get("deal_key"),
            subject=m.get("subject"),
            from_email=m.get("from_email"),
            from_name=m.get("from_name"),
            to_text=m.get("to_text"),
            cc_text=m.get("cc_text"),
            sent_at=m.get("sent_at"),
            body_text=m.get("body_text"),
            atts=json.dumps(m.get("attachments_json") or []),
            status=m.get("status") or "noise",
            role=m.get("role"),
            thread_key=m.get("thread_key"),
            folder=m.get("folder"),
        )
        inserted += 1
    return _ok({"inserted": inserted})


def _mail_deal_keys(conn, payload):
    ids = _str_list(payload.get("ids"), 200)
    if not ids:
        return _ok({})
    rows = conn.run(
        f"""
        SELECT DISTINCT ON (internet_message_id) internet_message_id, deal_key
        FROM {SCHEMA}.mail_messages
        WHERE internet_message_id = ANY(CAST(:ids AS text[])) AND deal_key IS NOT NULL
        """,
        ids=ids,
    )
    return _ok({r[0]: r[1] for r in rows})


def _mail_messages_for_deal(conn, payload):
    limit = min(max(int(payload.get("limit") or 80), 1), 200)
    return _ok(
        _rows(
            conn,
            f"""
            SELECT * FROM (
              SELECT {MAIL_MESSAGE_COLS}, body_text FROM {SCHEMA}.mail_messages
              WHERE deal_key = :key AND status = 'ingested'
              ORDER BY sent_at DESC NULLS LAST
              LIMIT :limit
            ) t ORDER BY sent_at ASC NULLS FIRST
            """,
            key=payload.get("deal_key"),
            limit=limit,
        )
    )


def _mail_recent_messages(conn, payload):
    limit = min(max(int(payload.get("limit") or 50), 1), 200)
    cols = ", ".join(f"m.{c.strip()}" for c in MAIL_MESSAGE_COLS.split(","))
    cid = payload.get("connection_id")
    where = "WHERE m.connection_id = :cid" if cid else ""
    params: dict[str, Any] = {"limit": limit}
    if cid:
        params["cid"] = cid
    return _ok(
        _rows(
            conn,
            f"""
            SELECT {cols}, j.status AS job_status, j.last_error AS job_error
            FROM {SCHEMA}.mail_messages m
            LEFT JOIN {SCHEMA}.mail_deal_jobs j ON j.deal_key = m.deal_key
            {where}
            ORDER BY m.sent_at DESC NULLS LAST
            LIMIT :limit
            """,
            **params,
        )
    )


def _mail_connection_stats(conn, payload):
    rows = _rows(
        conn,
        f"""
        SELECT connection_id,
               count(*)::int AS messages,
               count(*) FILTER (WHERE status = 'ingested')::int AS ingested,
               count(*) FILTER (WHERE status = 'noise')::int AS noise,
               count(DISTINCT deal_key) FILTER (WHERE status = 'ingested')::int AS deals,
               max(sent_at) AS last_message_at
        FROM {SCHEMA}.mail_messages GROUP BY connection_id
        """,
    )
    return _ok({r.pop("connection_id"): r for r in rows})


def _mail_jobs_mark_dirty(conn, payload):
    keys = _str_list(payload.get("deal_keys"), 1000)
    if keys:
        conn.run(
            f"""
            INSERT INTO {SCHEMA}.mail_deal_jobs (deal_key, status, dirty, updated_at)
            SELECT k, 'pending', true, now() FROM unnest(CAST(:keys AS text[])) AS k
            ON CONFLICT (deal_key) DO UPDATE SET dirty = true, updated_at = now()
            """,
            keys=keys,
        )
    return _ok({"marked": len(keys)})


def _mail_jobs_claim(conn, payload):
    limit = min(max(int(payload.get("limit") or 10), 1), 50)
    return _ok(
        _rows(
            conn,
            f"""
            UPDATE {SCHEMA}.mail_deal_jobs SET status = 'starting', dirty = false,
                   started_at = now(), updated_at = now()
            WHERE deal_key IN (
              SELECT deal_key FROM {SCHEMA}.mail_deal_jobs
              WHERE (dirty AND status NOT IN ('running', 'starting'))
                 OR (status = 'starting' AND started_at < now() - interval '10 minutes')
              ORDER BY updated_at ASC
              LIMIT :limit
              FOR UPDATE SKIP LOCKED
            )
            RETURNING {MAIL_JOB_COLS}
            """,
            limit=limit,
        )
    )


def _mail_jobs_running(conn, payload):
    limit = min(max(int(payload.get("limit") or 50), 1), 200)
    return _ok(
        _rows(
            conn,
            f"""
            SELECT {MAIL_JOB_COLS} FROM {SCHEMA}.mail_deal_jobs
            WHERE status = 'running' ORDER BY started_at ASC LIMIT :limit
            """,
            limit=limit,
        )
    )


def _mail_jobs_counts(conn, payload):
    rows = conn.run(
        f"SELECT status, count(*)::int FROM {SCHEMA}.mail_deal_jobs GROUP BY status"
    )
    return _ok({str(s): c for s, c in rows})


def _mail_job_update(conn, payload):
    key = payload.get("deal_key")
    update = payload.get("update") or {}
    sets: list[str] = []
    params: dict[str, Any] = {"key": key}
    for field, cast in JOB_UPDATE_FIELDS.items():
        if field not in update:
            continue
        value = update[field]
        if cast == "jsonb":
            params[field] = None if value is None else json.dumps(value)
            sets.append(f"{field} = CAST(:{field} AS jsonb)")
        else:
            params[field] = value
            sets.append(f"{field} = :{field}")
    if not key or not sets:
        return _ok({"updated": 0})
    conn.run(
        f"UPDATE {SCHEMA}.mail_deal_jobs SET {', '.join(sets)}, updated_at = now() WHERE deal_key = :key",
        **params,
    )
    return _ok({"updated": 1})


INBOX_MESSAGE_COLS = (
    "connection_id, provider_message_id, internet_message_id, in_reply_to, thread_key, folder, "
    "deal_key, subject, from_email, from_name, to_text, cc_text, sent_at, attachments_json, "
    "status, role"
)


def _mail_inbox_threads(conn, payload):
    """One page of conversations across the given mailboxes, newest first (keyset paged)."""
    ids = _str_list(payload.get("connection_ids"), 100)
    if not ids:
        return _ok({"threads": [], "messages": [], "has_more": False})
    limit = min(max(int(payload.get("limit") or 40), 1), 60)
    q = (payload.get("q") or "").strip()[:120]
    params: dict[str, Any] = {"ids": ids, "limit": limit + 1}
    search_sql = ""
    if q:
        params["like"] = f"%{_escape_like(q)}%"
        search_sql = (
            " AND (subject ILIKE :like ESCAPE '\\' OR from_email ILIKE :like ESCAPE '\\'"
            " OR coalesce(from_name, '') ILIKE :like ESCAPE '\\' OR coalesce(to_text, '') ILIKE :like ESCAPE '\\'"
            " OR coalesce(body_text, '') ILIKE :like ESCAPE '\\')"
        )
    cursor_sql = ""
    if payload.get("before_at"):
        params["before_at"] = str(payload["before_at"])
        params["before_key"] = str(payload.get("before_key") or "")
        cursor_sql = "WHERE (last_at, thread_key) < (CAST(:before_at AS timestamptz), :before_key)"
    threads = _rows(
        conn,
        f"""
        WITH t AS (
          SELECT thread_key, max(sent_at) AS last_at,
                 count(DISTINCT coalesce(internet_message_id, provider_message_id))::int AS message_count
          FROM {SCHEMA}.mail_messages
          WHERE connection_id = ANY(CAST(:ids AS text[])) AND status <> 'error'
            AND sent_at IS NOT NULL AND thread_key IS NOT NULL{search_sql}
          GROUP BY thread_key
          HAVING bool_or(coalesce(folder, 'inbox') <> 'sent')
        )
        SELECT thread_key, last_at, message_count FROM t {cursor_sql}
        ORDER BY last_at DESC, thread_key DESC
        LIMIT :limit
        """,
        **params,
    )
    has_more = len(threads) > limit
    threads = threads[:limit]
    keys = [t["thread_key"] for t in threads]
    messages: list[dict] = []
    if keys:
        messages = _rows(
            conn,
            f"""
            SELECT * FROM (
              SELECT d.*, row_number() OVER (PARTITION BY d.thread_key ORDER BY d.sent_at DESC) AS rn
              FROM (
                SELECT DISTINCT ON (thread_key, coalesce(internet_message_id, connection_id || ':' || provider_message_id))
                       {INBOX_MESSAGE_COLS}, left(coalesce(body_text, ''), 700) AS body_text
                FROM {SCHEMA}.mail_messages
                WHERE connection_id = ANY(CAST(:ids AS text[])) AND thread_key = ANY(CAST(:keys AS text[]))
                  AND status <> 'error' AND sent_at IS NOT NULL
                ORDER BY thread_key, coalesce(internet_message_id, connection_id || ':' || provider_message_id), sent_at DESC
              ) d
            ) r WHERE rn <= 8
            ORDER BY thread_key, sent_at ASC
            """,
            ids=ids,
            keys=keys,
        )
    return _ok({"threads": threads, "messages": messages, "has_more": has_more})


def _mail_thread_messages(conn, payload):
    """Every copy-deduped message of one conversation (full bodies), oldest first."""
    ids = _str_list(payload.get("connection_ids"), 100)
    key = (payload.get("thread_key") or "").strip()
    if not ids or not key:
        return _ok([])
    limit = min(max(int(payload.get("limit") or 30), 1), 60)
    return _ok(
        _rows(
            conn,
            f"""
            SELECT * FROM (
              SELECT DISTINCT ON (coalesce(internet_message_id, connection_id || ':' || provider_message_id))
                     {INBOX_MESSAGE_COLS}, body_text
              FROM {SCHEMA}.mail_messages
              WHERE connection_id = ANY(CAST(:ids AS text[])) AND thread_key = :key
                AND status <> 'error' AND sent_at IS NOT NULL
              ORDER BY coalesce(internet_message_id, connection_id || ':' || provider_message_id), sent_at DESC
            ) d
            ORDER BY sent_at DESC
            LIMIT :limit
            """,
            ids=ids,
            key=key,
            limit=limit,
        )
    )


MAIL_ACTIONS = {
    "mail_inbox_threads": _mail_inbox_threads,
    "mail_thread_messages": _mail_thread_messages,
    "mail_list_connections": _mail_list_connections,
    "mail_get_connection": _mail_get_connection,
    "mail_save_connection": _mail_save_connection,
    "mail_delete_connection": _mail_delete_connection,
    "mail_acquire_lock": _mail_acquire_lock,
    "mail_release_lock": _mail_release_lock,
    "mail_known_ids": _mail_known_ids,
    "mail_insert_messages": _mail_insert_messages,
    "mail_deal_keys": _mail_deal_keys,
    "mail_messages_for_deal": _mail_messages_for_deal,
    "mail_recent_messages": _mail_recent_messages,
    "mail_connection_stats": _mail_connection_stats,
    "mail_jobs_mark_dirty": _mail_jobs_mark_dirty,
    "mail_jobs_claim": _mail_jobs_claim,
    "mail_jobs_running": _mail_jobs_running,
    "mail_jobs_counts": _mail_jobs_counts,
    "mail_job_update": _mail_job_update,
}


def lambda_handler(event, context):
    if isinstance(event.get("body"), str):
        try:
            payload = json.loads(event["body"] or "{}")
        except json.JSONDecodeError:
            return _err("Invalid JSON body")
    else:
        payload = event or {}

    action = (payload.get("action") or "health").strip()
    try:
        conn = _connect()
        if action == "migrate":
            return _migrate(conn)
        if action == "health":
            return _health(conn)
        if action == "list_deals":
            return _list_deals(conn, payload)
        if action == "get_evidence":
            return _get_evidence(conn, payload)
        if action == "upsert_deals":
            return _upsert_deals(conn, payload)
        if action in MAIL_ACTIONS:
            return MAIL_ACTIONS[action](conn, payload)
        return _err(f"Unknown action: {action}")
    except Exception as e:
        logger.exception("trade-suite-rds-proxy failed")
        return _err(str(e))
