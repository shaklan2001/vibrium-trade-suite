#!/usr/bin/env python3
"""Restore local SQLite processed_deals into Aurora schema trade_suite via Lambda proxy.

  AWS_BIN=... DB_PASSWORD=... python scripts/restore-to-rds-proxy.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQLITE = Path(
    os.environ.get(
        "SQLITE_PATH",
        str(ROOT / "data/pst_extract/relevant/processed.db"),
    )
)
AWS = os.environ.get("AWS_BIN", "aws")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
FN = os.environ.get("TRADE_SUITE_RDS_PROXY_NAME", "trade-suite-rds-proxy")


def parse_json(value, fallback):
    if value is None or value == "":
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return fallback


def invoke(payload: dict) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        path = f.name
    out = tempfile.mktemp(suffix=".out.json")
    try:
        subprocess.check_call(
            [
                AWS,
                "lambda",
                "invoke",
                "--region",
                REGION,
                "--function-name",
                FN,
                "--payload",
                f"file://{path}",
                out,
            ],
            stdout=subprocess.DEVNULL,
        )
        return json.loads(Path(out).read_text())
    finally:
        Path(path).unlink(missing_ok=True)
        Path(out).unlink(missing_ok=True)


def main() -> int:
    if not SQLITE.exists():
        print(f"missing sqlite: {SQLITE}", file=sys.stderr)
        return 1
    mig = invoke({"action": "migrate"})
    print("migrate", mig)
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

    # Optional evidence from deals.jsonl if present
    evidence_by_id: dict[str, dict] = {}
    deals_path = ROOT / "data/pst_extract/relevant/deals.jsonl"
    if deals_path.exists():
        # evidence is built server-side during process; skip heavy parse here
        pass

    batch: list[dict] = []
    total = 0
    for row in rows:
        batch.append(
            {
                "id": row["id"],
                "po_numbers": parse_json(row["po_numbers"], []),
                "subject": row["subject"],
                "primary_stage": row["primary_stage"],
                "slot": row["slot"],
                "agent_id": row["agent_id"],
                "execution_id": row["execution_id"],
                "status": row["status"],
                "summary": row["summary"],
                "confidence": row["confidence"],
                "date_start": row["date_start"],
                "date_end": row["date_end"],
                "message_count": row["message_count"],
                "doc_count": row["doc_count"],
                "parties_json": parse_json(row["parties_json"], {}),
                "result_json": parse_json(row["result_json"], None),
                "error": row["error"],
                "processed_at": row["processed_at"],
                "cost_usd": row["cost_usd"],
                "input_tokens": row["input_tokens"],
                "output_tokens": row["output_tokens"],
                "commercial_model": row["commercial_model"],
                "evidence_json": evidence_by_id.get(row["id"]),
            }
        )
        if len(batch) >= 50:
            res = invoke({"action": "upsert_deals", "rows": batch})
            if not res.get("success"):
                print("FAIL", res, file=sys.stderr)
                return 1
            total += res.get("data", {}).get("upserted", 0)
            print(f"upserted {total}/{len(rows)}")
            batch = []
    if batch:
        res = invoke({"action": "upsert_deals", "rows": batch})
        if not res.get("success"):
            print("FAIL", res, file=sys.stderr)
            return 1
        total += res.get("data", {}).get("upserted", 0)
    health = invoke({"action": "health"})
    print("done upserted=", total, "health=", health)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
