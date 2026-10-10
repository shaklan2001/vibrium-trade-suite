#!/usr/bin/env python3
"""Backfill evidence_json + commercial_model onto Neon processed_deals from deals.jsonl.

Does not re-run agents. Safe to run while the UI is up.

  scripts/pst-extract/.venv/bin/python scripts/pst-extract/backfill_evidence.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from process_deals import (  # noqa: E402
    DEALS_PATH,
    build_evidence,
    clip_email,
    connect_pg,
    ensure_pg_schema,
    load_env,
    pick_document,
)

MSG_BODY_LIMIT = 10_000


def main() -> int:
    load_env()
    pg = connect_pg()
    if pg is None:
        raise SystemExit("DATABASE_URL missing")
    ensure_pg_schema(pg)

    ids = {r[0] for r in pg.execute("SELECT id FROM processed_deals")}
    print(f"neon rows needing evidence: {len(ids)}")
    if not DEALS_PATH.exists():
        raise SystemExit(f"missing {DEALS_PATH}")

    from psycopg.types.json import Jsonb

    updated = 0
    missing = 0
    for line in DEALS_PATH.open(encoding="utf-8"):
        if not line.strip():
            continue
        deal = json.loads(line)
        deal_id = deal.get("id")
        if not deal_id or deal_id not in ids:
            continue
        slot_row = pg.execute(
            "SELECT slot, document_name, document_url, commercial_model FROM processed_deals WHERE id = %s",
            (deal_id,),
        ).fetchone()
        if not slot_row:
            missing += 1
            continue
        slot = slot_row[0] or "requirement_extractor"
        doc_name = slot_row[1]
        doc_url = slot_row[2]
        model = slot_row[3] or deal.get("commercial_model") or "agency_commission"
        doc = None
        if doc_name:
            for d in deal.get("documents") or []:
                if (d.get("name") or "") == doc_name:
                    doc = d
                    break
        if doc is None:
            doc = pick_document(deal, slot)
        email = clip_email(deal)
        evidence = build_evidence(
            deal, slot=slot, email=email, doc=doc, document_url=doc_url
        )
        if doc and not evidence.get("document_name"):
            evidence["document_name"] = doc.get("name")
        pg.execute(
            """
            UPDATE processed_deals
            SET evidence_json = %s,
                commercial_model = COALESCE(commercial_model, %s),
                document_name = COALESCE(document_name, %s),
                document_url = COALESCE(document_url, %s)
            WHERE id = %s
            """,
            (
                Jsonb(evidence),
                model,
                evidence.get("document_name"),
                evidence.get("document_url"),
                deal_id,
            ),
        )
        updated += 1
        if updated % 25 == 0:
            print(f"  updated {updated}…")

    print(f"done updated={updated} missing_pack={missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
