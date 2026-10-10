#!/usr/bin/env python3
"""Backfill evidence_json onto Aurora trade_suite via trade-suite-rds-proxy.

Mirrors scripts/pst-extract/backfill_evidence.py but uses the VPC Lambda
(same access pattern as vibrium-backend rds-query-proxy callers).

  AWS_BIN=/tmp/awscli-venv/bin/aws \\
    scripts/pst-extract/.venv/bin/python scripts/backfill-evidence-rds-proxy.py
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
SCRIPT_DIR = ROOT / "scripts" / "pst-extract"
sys.path.insert(0, str(SCRIPT_DIR))

from process_deals import (  # noqa: E402
    DEALS_PATH,
    build_evidence,
    clip_email,
    pick_document,
)

SQLITE = Path(
    os.environ.get(
        "SQLITE_PATH",
        str(ROOT / "data/pst_extract/relevant/processed.db"),
    )
)
AWS = os.environ.get("AWS_BIN", "aws")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
FN = os.environ.get("TRADE_SUITE_RDS_PROXY_NAME", "trade-suite-rds-proxy")


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
    if not SQLITE.exists():
        print(f"missing sqlite: {SQLITE}", file=sys.stderr)
        return 1
    if not DEALS_PATH.exists():
        print(f"missing deals: {DEALS_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(SQLITE))
    conn.row_factory = sqlite3.Row
    rows = {
        r["id"]: r
        for r in conn.execute(
            """
            SELECT id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
                   status, summary, confidence, date_start, date_end, message_count, doc_count,
                   parties_json, result_json, error, processed_at, cost_usd, input_tokens,
                   output_tokens, commercial_model
            FROM processed_deals
            """
        )
    }
    conn.close()
    print(f"sqlite rows: {len(rows)}")

    batch: list[dict] = []
    updated = 0
    skipped = 0
    for line in DEALS_PATH.open(encoding="utf-8"):
        if not line.strip():
            continue
        deal = json.loads(line)
        deal_id = deal.get("id")
        if not deal_id or deal_id not in rows:
            continue
        base = rows[deal_id]
        slot = base["slot"] or "requirement_extractor"
        model = base["commercial_model"] or deal.get("commercial_model") or "agency_commission"
        doc = pick_document(deal, slot)
        email = clip_email(deal)
        evidence = build_evidence(
            deal, slot=slot, email=email, doc=doc, document_url=None
        )
        if doc and not evidence.get("document_name"):
            evidence["document_name"] = doc.get("name")
        batch.append(
            {
                "id": deal_id,
                "po_numbers": parse_json(base["po_numbers"], []),
                "subject": base["subject"],
                "primary_stage": base["primary_stage"],
                "slot": base["slot"],
                "agent_id": base["agent_id"],
                "execution_id": base["execution_id"],
                "status": base["status"],
                "summary": base["summary"],
                "confidence": base["confidence"],
                "date_start": base["date_start"],
                "date_end": base["date_end"],
                "message_count": base["message_count"],
                "doc_count": base["doc_count"],
                "parties_json": parse_json(base["parties_json"], {}),
                "result_json": parse_json(base["result_json"], None),
                "error": base["error"],
                "processed_at": base["processed_at"],
                "cost_usd": base["cost_usd"],
                "input_tokens": base["input_tokens"],
                "output_tokens": base["output_tokens"],
                "commercial_model": model,
                "evidence_json": evidence,
                "document_name": evidence.get("document_name"),
                "document_url": evidence.get("document_url"),
            }
        )
        if len(batch) >= 25:
            res = invoke({"action": "upsert_deals", "rows": batch})
            if not res.get("success"):
                print("FAIL", res, file=sys.stderr)
                return 1
            updated += res.get("data", {}).get("upserted", 0)
            print(f"  upserted {updated}")
            batch = []

    if batch:
        res = invoke({"action": "upsert_deals", "rows": batch})
        if not res.get("success"):
            print("FAIL", res, file=sys.stderr)
            return 1
        updated += res.get("data", {}).get("upserted", 0)

    # verify a sample
    sample = invoke({"action": "list_deals", "limit": 5})
    rows_out = sample.get("data") or []
    ev = sum(1 for r in rows_out if r.get("evidence_json"))
    print(f"done updated={updated} skipped={skipped} sample_evidence={ev}/{len(rows_out)}")
    health = invoke({"action": "health"})
    print("health", health)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
