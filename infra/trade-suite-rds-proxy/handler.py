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
            "tables": ["processed_deals", "ingest_progress"],
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


def _list_deals(conn: pg8000.native.Connection, payload: dict) -> dict:
    stage = (payload.get("stage") or "").strip()
    # Page size capped for Lambda response size; callers should paginate via offset.
    limit = min(max(int(payload.get("limit") or 400), 1), 500)
    offset = max(int(payload.get("offset") or 0), 0)
    if stage and not IDENTIFIER_RE.match(stage):
        return _err("invalid stage")
    # list_deals omits evidence_json (can be multi-MB) — fetch via get_evidence.
    if stage:
        rows = conn.run(
            f"""
            SELECT id, po_numbers, subject, primary_stage, slot, agent_id,
                   status, summary, confidence, date_start, date_end,
                   message_count, doc_count, parties_json, error, processed_at,
                   cost_usd, input_tokens, output_tokens, result_json,
                   commercial_model, document_name, document_url,
                   (evidence_json IS NOT NULL) AS has_evidence
            FROM {SCHEMA}.processed_deals
            WHERE primary_stage = :stage
            ORDER BY date_end DESC NULLS LAST
            LIMIT :limit OFFSET :offset
            """,
            stage=stage,
            limit=limit,
            offset=offset,
        )
    else:
        rows = conn.run(
            f"""
            SELECT id, po_numbers, subject, primary_stage, slot, agent_id,
                   status, summary, confidence, date_start, date_end,
                   message_count, doc_count, parties_json, error, processed_at,
                   cost_usd, input_tokens, output_tokens, result_json,
                   commercial_model, document_name, document_url,
                   (evidence_json IS NOT NULL) AS has_evidence
            FROM {SCHEMA}.processed_deals
            ORDER BY date_end DESC NULLS LAST
            LIMIT :limit OFFSET :offset
            """,
            limit=limit,
            offset=offset,
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
    ]
    deals = [dict(zip(cols, r)) for r in rows]
    stage_rows = conn.run(
        f"""
        SELECT primary_stage, count(*)::int
        FROM {SCHEMA}.processed_deals GROUP BY primary_stage
        """
    )
    status_rows = conn.run(
        f"""
        SELECT status, count(*)::int
        FROM {SCHEMA}.processed_deals GROUP BY status
        """
    )
    model_rows = conn.run(
        f"""
        SELECT commercial_model, count(*)::int
        FROM {SCHEMA}.processed_deals
        WHERE status = 'completed'
        GROUP BY commercial_model
        """
    )
    total = conn.run(f"SELECT count(*)::int FROM {SCHEMA}.processed_deals")[0][0]
    spend = conn.run(
        f"SELECT coalesce(sum(cost_usd), 0)::float8 FROM {SCHEMA}.processed_deals"
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
        return _err(f"Unknown action: {action}")
    except Exception as e:
        logger.exception("trade-suite-rds-proxy failed")
        return _err(str(e))
