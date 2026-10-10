#!/usr/bin/env python3
"""Restore Neon processed_deals from local SQLite checkpoint.

  DATABASE_URL=... scripts/pst-extract/.venv/bin/python \
    scripts/pst-extract/restore_from_sqlite.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
SQLITE = Path(
    os.environ.get(
        "SQLITE_PATH",
        str(ROOT / "data/pst_extract/relevant/processed.db"),
    )
)


def parse_json(value, fallback):
    if value is None or value == "":
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return fallback


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not SQLITE.exists():
        print(f"missing sqlite: {SQLITE}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(SQLITE))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
               status, summary, confidence, date_start, date_end, message_count, doc_count,
               parties_json, result_json, error, processed_at, cost_usd, input_tokens,
               output_tokens, commercial_model
        FROM processed_deals
        """
    ).fetchall()
    conn.close()

    upserted = 0
    with psycopg.connect(url) as pg:
        with pg.cursor() as cur:
            for i, row in enumerate(rows, 1):
                cur.execute(
                    """
                    INSERT INTO processed_deals (
                      id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
                      status, summary, confidence, date_start, date_end, message_count, doc_count,
                      parties_json, result_json, error, processed_at, cost_usd, input_tokens,
                      output_tokens, commercial_model
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s,
                      %s, %s
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
                      commercial_model = EXCLUDED.commercial_model
                    """,
                    (
                        row["id"],
                        Jsonb(parse_json(row["po_numbers"], [])),
                        row["subject"],
                        row["primary_stage"],
                        row["slot"],
                        row["agent_id"],
                        row["execution_id"],
                        row["status"],
                        row["summary"],
                        row["confidence"],
                        row["date_start"],
                        row["date_end"],
                        row["message_count"],
                        row["doc_count"],
                        Jsonb(parse_json(row["parties_json"], {})),
                        Jsonb(parse_json(row["result_json"], None))
                        if row["result_json"]
                        else None,
                        row["error"],
                        row["processed_at"],
                        row["cost_usd"],
                        row["input_tokens"],
                        row["output_tokens"],
                        row["commercial_model"],
                    ),
                )
                upserted += 1
                if i % 25 == 0 or i == len(rows):
                    print(f"upserted {i}/{len(rows)}")
            pg.commit()
            cur.execute("SELECT count(*) FROM processed_deals")
            count = cur.fetchone()[0]

    print(f"done sqlite={len(rows)} neon={count} upserted={upserted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
