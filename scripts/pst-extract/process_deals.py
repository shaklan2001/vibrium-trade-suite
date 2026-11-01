#!/usr/bin/env python3
"""Feed relevant deal packs to Vibrium workers. Local runner, resume-safe.

Uploads the best PDF/xlsx to S3 prefix trade/pst-ingest (presigned GET for
workers), runs the stage worker, stores compact results in JSONL, local
SQLite, and Neon (DATABASE_URL).

Usage:
  python process_deals.py --dry-run --limit 20
  python process_deals.py --limit 5
  python process_deals.py
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sqlite3
import time
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
RELEVANT = ROOT / "data" / "pst_extract" / "relevant"
DEALS_PATH = RELEVANT / "deals.jsonl"
INDEX_PATH = RELEVANT / "deals-index.jsonl"
RESULTS_PATH = RELEVANT / "agent-results.jsonl"
CACHE_PATH = RELEVANT / "upload-cache.json"
DB_PATH = RELEVANT / "processed.db"
PROGRESS_PATH = RELEVANT / "progress.json"
IDS_PATH = ROOT / "scripts" / "agent-ids.json"
ENV_PATH = ROOT / ".env.local"
ATTACH_ROOT = ROOT / "data" / "pst_extract"
EMAIL_CHAR_LIMIT = 24_000
POLL_SECONDS = 2.5
POLL_TIMEOUT = 600
S3_PRESIGN_SECONDS = 7 * 24 * 3600

STAGE_SLOT = {
    "requirement": "requirement_extractor",
    "quoting": "quote_normalizer",
    "artwork": "artwork_checklist_extractor",
    "samples": "sample_request_summarizer",
    "inspection": "inspection_photo_summarizer",
    "booking": "booking_extractor",
    "payment": "payment_clock",
    "commission": "commission_checklist",
    "other": "requirement_extractor",
}

DOC_REQUIRED = {
    "quote_normalizer",
    "pi_extractor",
    "po_extractor",
    "booking_extractor",
    "inspection_photo_summarizer",
}
# artwork_checklist_extractor accepts email_text OR document_url
DOC_OPTIONAL = {
    "artwork_checklist_extractor",
    "sample_request_summarizer",
    "final_docs_pack_check",
}

# Modern formats the Vibrium markdown resolver can read
MODERN_DOC_EXT = {".pdf", ".xlsx", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"}
LEGACY_DOC_EXT = {".doc", ".xls", ".ppt", ".rtf", ".csv"}

FREIGHT_DOC_TOKENS = (
    "hbl",
    "mbl",
    "bkgconf",
    "bkg_",
    "bkg-",
    "bkg ",
    "bill of lading",
    "telex release",
    "telex",
    "air waybill",
    "eawb",
    " awb",
    "awb.",
    "bl.pdf",
    "draft bl",
    "draft hbl",
    "shipping bill",
    "si form",
    "vgm",
    "booking confirmation",
    "booking conf",
)

FREIGHT_DOC_PENALTY = (
    "packing list",
    "pack list",
    "commercial invoice",
    "proforma",
    "purchase order",
    "artwork",
    "inspection",
    "coa ",
    "certificate of analysis",
)

KIND_PREF = {
    "quoting": (".xlsx", ".pdf", ".docx"),
    "pi_po": (".pdf", ".xlsx", ".docx"),
    "booking": (".pdf", ".xlsx"),
    "requirement": (".pdf", ".xlsx", ".docx"),
    "artwork": (".pdf", ".docx", ".pptx"),
    "samples": (".pdf", ".xlsx", ".png", ".jpg"),
    "inspection": (".pdf", ".png", ".jpg", ".jpeg", ".webp", ".pptx"),
    "payment": (".pdf", ".xlsx"),
    "other": (".pdf", ".xlsx", ".docx"),
}

DOC_NAME_BONUS = {
    "booking": (
        "hbl",
        "mbl",
        "bkgconf",
        "booking confirmation",
        "booking conf",
        "bill of lading",
        "telex",
        "awb",
        "bl.pdf",
        "draft bl",
        "shipping bill",
        "vgm",
    ),
    "quoting": ("quote", "quotation", "price", "as sheet", "costing", "offer"),
    "pi_po": ("proforma", "performa", "purchase order", "pi-", "pi ", "po#", " po "),
    "requirement": ("rfq", "enquiry", "spec", "reorder", "quote sheet"),
    "artwork": ("art", "logo", "print", "dieline", "packaging"),
    "samples": ("sample", "proto"),
    "inspection": ("inspect", "qc", "packing list", "photo"),
    "payment": ("bl", "bill of lading", "tt", "payment", "debit"),
}

DOC_NAME_PENALTY = {
    "booking": (
        "debit note",
        "gst",
        "payment summary",
        "invoice",
        "packing list",
        "artwork",
        "coa",
        "purchase order",
    ),
    "quoting": ("e-way", "eway", "packing list", "delivery note", "coa", "certificate of analysis"),
    "pi_po": ("packing list", "shipping marks", "sticker", "logo"),
    "requirement": ("eawb", "air waybill", "company profile"),
}


def log(msg: str) -> None:
    print(msg, flush=True)


def human_duration(seconds: float) -> str:
    total = int(max(0, seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m {s:02d}s"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def write_progress(payload: dict[str, Any], pg=None) -> None:
    payload = {
        **payload,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    tmp = PROGRESS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(PROGRESS_PATH)
    if pg is None:
        return
    from psycopg.types.json import Jsonb

    try:
        pg.execute(
            """
            INSERT INTO ingest_progress (id, payload, updated_at)
            VALUES ('current', %s, now())
            ON CONFLICT (id) DO UPDATE SET
              payload = EXCLUDED.payload,
              updated_at = now()
            """,
            (Jsonb(payload),),
        )
    except Exception as exc:
        print(f"Neon progress skipped — {type(exc).__name__}")


def count_pending(
    done: set[str],
    stage: str | None,
    limit: int | None,
    with_docs: bool = False,
    source: Path | None = None,
) -> int:
    path = source or (DEALS_PATH if with_docs else (INDEX_PATH if INDEX_PATH.exists() else DEALS_PATH))
    n = 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if stage and row.get("primary_stage") != stage:
                continue
            if row.get("id") in done:
                continue
            if with_docs and not pick_document(row):
                continue
            n += 1
            if limit is not None and n >= limit:
                return n
    return n


def load_env() -> None:
    if not ENV_PATH.exists():
        raise SystemExit(f"Missing {ENV_PATH}")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def api_base() -> str:
    return (os.environ.get("VIBRIUM_API_BASE_URL") or "").rstrip("/")


def customer_id() -> str:
    return os.environ.get("VIBRIUM_CUSTOMER_ID") or ""


def mint_token() -> str:
    user = os.environ.get("VIBRIUM_SERVICE_USERNAME") or ""
    password = os.environ.get("VIBRIUM_SERVICE_PASSWORD") or ""
    if not api_base() or not customer_id() or not user or not password:
        raise SystemExit("Missing VIBRIUM_* env in .env.local")
    import base64

    basic = base64.b64encode(f"{user}:{password}".encode()).decode()
    url = f"{api_base()}/v1/customers/{customer_id()}/auth/token"
    req = urllib.request.Request(
        url,
        data=b"{}",
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = json.loads(res.read().decode())
    token = (payload.get("data") or {}).get("token") or payload.get("token")
    if not token:
        raise SystemExit("Vibrium auth failed: no token")
    return token


def api_json(token: str, method: str, path: str, body: Any = None) -> Any:
    url = f"{api_base()}/v1/customers/{customer_id()}/{path.lstrip('/')}"
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method=method,
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                raw = res.read().decode()
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:500]
            last_error = RuntimeError(f"{method} {path} -> {exc.code}: {detail}")
            if exc.code in {429, 502, 503, 504} and attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise last_error from exc
        except (TimeoutError, urllib.error.URLError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise
    raise last_error or RuntimeError(f"{method} {path} failed")


def unwrap(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def load_ids() -> dict[str, str]:
    ids = json.loads(IDS_PATH.read_text(encoding="utf-8"))
    env_map = {
        "requirement_extractor": "NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR",
        "quote_normalizer": "NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER",
        "artwork_checklist_extractor": "NEXT_PUBLIC_AGENT_ARTWORK_CHECKLIST",
        "sample_request_summarizer": "NEXT_PUBLIC_AGENT_SAMPLE_REQUEST",
        "pi_extractor": "NEXT_PUBLIC_AGENT_PI_EXTRACTOR",
        "po_extractor": "NEXT_PUBLIC_AGENT_PO_EXTRACTOR",
        "inspection_photo_summarizer": "NEXT_PUBLIC_AGENT_INSPECTION",
        "booking_extractor": "NEXT_PUBLIC_AGENT_BOOKING",
        "payment_clock": "NEXT_PUBLIC_AGENT_PAYMENT_CLOCK",
        "commission_checklist": "NEXT_PUBLIC_AGENT_COMMISSION",
        "final_docs_pack_check": "NEXT_PUBLIC_AGENT_DOCS_PACK",
    }
    for slot, env_name in env_map.items():
        ids[slot] = os.environ.get(env_name) or ids.get(slot) or ""
    return ids


def choose_slot(deal: dict[str, Any]) -> str:
    stage = deal.get("primary_stage") or "other"
    blob = " ".join(
        deal.get("subjects") or [deal.get("subject") or ""]
    ).lower()
    if "commission" in blob or stage == "commission":
        return "commission_checklist"
    if stage == "pi_po":
        # Prefer real commercial docs; otherwise logistics/docs pack from email
        wants_po = "purchase order" in blob or "po#" in blob or "po #" in blob
        if wants_po and has_modern_document(deal, ("po", "purchase", "order")):
            return "po_extractor"
        if has_modern_document(deal, ("proforma", "performa", "pi-", "pi ", "pi_")):
            return "pi_extractor"
        if wants_po and has_modern_document(deal):
            return "po_extractor"
        if has_modern_document(deal):
            return "pi_extractor"
        # Email-only PI/PO threads → docs/logistics summarizer (not skip)
        return "final_docs_pack_check"
    if stage == "booking":
        # Only call booking_extractor when a modern freight doc exists.
        if has_freight_document(deal):
            return "booking_extractor"
        if has_modern_document(deal, ("po", "purchase")):
            return "po_extractor"
        if has_modern_document(deal, ("proforma", "performa", "pi-", "pi ")):
            return "pi_extractor"
        if any(
            tok in blob
            for tok in ("payment", "remit", "tt against", "outstanding", "dues")
        ):
            return "payment_clock"
        # Logistics / forwarding / shipping-bill / surrender threads
        return "final_docs_pack_check"
    if stage == "inspection":
        if has_modern_document(deal):
            return "inspection_photo_summarizer"
        return "final_docs_pack_check"
    if stage == "quoting":
        if has_modern_document(
            deal, ("quote", "quotation", "price", "costing", "as sheet", "offer", "revised")
        ):
            return "quote_normalizer"
        # Price talk in email without a quote workbook → requirement brief
        return "requirement_extractor"
    return STAGE_SLOT.get(stage, "requirement_extractor")


def doc_ext(doc: dict[str, Any]) -> str:
    name = (doc.get("name") or "").lower()
    return Path(name).suffix.lower() or (doc.get("ext") or "").lower()


def has_modern_document(deal: dict[str, Any], name_hints: tuple[str, ...] = ()) -> bool:
    for doc in deal.get("documents") or []:
        if doc_ext(doc) not in MODERN_DOC_EXT:
            continue
        if not local_doc_path(doc):
            continue
        if not name_hints:
            return True
        name = (doc.get("name") or "").lower()
        if any(h in name for h in name_hints):
            return True
    return False


def has_freight_document(deal: dict[str, Any]) -> bool:
    for doc in deal.get("documents") or []:
        if doc_ext(doc) not in MODERN_DOC_EXT - {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        if not local_doc_path(doc):
            continue
        name = (doc.get("name") or "").lower()
        if any(p in name for p in FREIGHT_DOC_PENALTY) and not any(
            t in name for t in ("hbl", "mbl", "bkgconf", "bill of lading", "draft bl")
        ):
            continue
        if any(tok in name for tok in FREIGHT_DOC_TOKENS):
            return True
    return False


def deal_context_notes(deal: dict[str, Any]) -> str:
    """Compact structured context prepended for workers (mail chain + model)."""
    model = deal.get("commercial_model") or "agency_commission"
    chain = deal.get("chain") or []
    parties = deal.get("parties") or {}
    lines = [
        f"commercial_model: {model}",
        "agency_commission = SNSPL is referee only; buyer↔exporter settle directly; SNSPL earns commission.",
        "trader_principal = Global Praise (or SNSPL trading) buys/sells as principal; grip cash & inventory.",
        f"message_count: {deal.get('message_count') or 0}",
        f"po_numbers: {', '.join(deal.get('po_numbers') or []) or 'none'}",
        f"buyers: {', '.join((parties.get('buyer') or [])[:4]) or 'none'}",
        f"factories: {', '.join((parties.get('factory') or [])[:4]) or 'none'}",
        f"trader: {', '.join((parties.get('trader') or [])[:4]) or 'none'}",
        f"forwarders: {', '.join((parties.get('forwarder') or [])[:4]) or 'none'}",
        "mail_chain (oldest→newest):",
    ]
    for item in chain[:40]:
        lines.append(
            f"  #{item.get('n')} {item.get('date') or ''} | {item.get('role') or ''} | "
            f"{(item.get('from') or '')[:40]} | {(item.get('subject') or '')[:80]}"
        )
    if len(chain) > 40:
        lines.append(f"  … {len(chain) - 40} more messages")
    return "\n".join(lines)


def local_doc_path(doc: dict[str, Any]) -> Path | None:
    mailbox = doc.get("mailbox")
    rel = doc.get("path")
    if not mailbox or not rel:
        return None
    path = ATTACH_ROOT / mailbox / "attachments" / rel
    return path if path.exists() else None


def pick_document(deal: dict[str, Any], slot: str | None = None) -> dict[str, Any] | None:
    stage = deal.get("primary_stage") or "other"
    preferred = KIND_PREF.get(stage, (".pdf", ".xlsx"))
    bonus = list(DOC_NAME_BONUS.get(stage, ()))
    penalty = list(DOC_NAME_PENALTY.get(stage, ()))
    # Slot-aware overrides: docs-pack wants CI/PL even on booking-stage deals
    if slot == "final_docs_pack_check":
        preferred = (".pdf", ".xlsx", ".docx")
        bonus = [
            "packing list",
            "pack list",
            "commercial invoice",
            "invoice",
            "hbl",
            "mbl",
            "bill of lading",
            "shipping bill",
            "certificate of origin",
            "coo",
            "telex",
        ]
        penalty = ["artwork", "logo", "upc", "coa", "sample"]
    elif slot == "booking_extractor":
        bonus = list(DOC_NAME_BONUS.get("booking", ()))
        penalty = list(DOC_NAME_PENALTY.get("booking", ()))
    elif slot in {"pi_extractor", "po_extractor"}:
        preferred = (".pdf", ".xlsx", ".docx")
        bonus = list(DOC_NAME_BONUS.get("pi_po", ()))
        penalty = list(DOC_NAME_PENALTY.get("pi_po", ()))
    docs = deal.get("documents") or []
    ranked: list[tuple[int, dict[str, Any]]] = []
    for doc in docs:
        name = (doc.get("name") or "").lower()
        ext = Path(name).suffix.lower() or (doc.get("ext") or "").lower()
        # Vibrium markdown resolver rejects legacy Office binaries
        if ext in LEGACY_DOC_EXT or ext not in MODERN_DOC_EXT:
            continue
        if ext in preferred:
            score = preferred.index(ext)
        else:
            score = 10
        if any(token in name for token in bonus):
            score -= 20
        if any(token in name for token in penalty):
            score += 30
        # Booking extractor: hard-prefer freight docs
        if slot == "booking_extractor" or (slot is None and stage == "booking"):
            if any(tok in name for tok in FREIGHT_DOC_TOKENS):
                score -= 40
            if any(tok in name for tok in FREIGHT_DOC_PENALTY):
                score += 50
            elif any(tok in name for tok in ("po", "purchase", "artwork", "logo", "upc")):
                score += 50
        ranked.append((score, doc))
    ranked.sort(key=lambda item: item[0])
    for _score, doc in ranked:
        if local_doc_path(doc):
            return doc
    return None


def clip_email(deal: dict[str, Any]) -> str:
    text = deal.get("agent_email_text") or ""
    if len(text) <= EMAIL_CHAR_LIMIT:
        return text
    return text[:EMAIL_CHAR_LIMIT] + "\n\n[truncated for worker input]"


def init_db() -> sqlite3.Connection:
    RELEVANT.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS processed_deals (
          id TEXT PRIMARY KEY,
          po_numbers TEXT,
          subject TEXT,
          primary_stage TEXT,
          slot TEXT,
          agent_id TEXT,
          execution_id TEXT,
          status TEXT,
          summary TEXT,
          confidence REAL,
          date_start TEXT,
          date_end TEXT,
          message_count INTEGER,
          doc_count INTEGER,
          parties_json TEXT,
          result_json TEXT,
          error TEXT,
          processed_at TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS processed_deals_stage ON processed_deals(primary_stage)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS processed_deals_status ON processed_deals(status)"
    )
    for col, typ in (
        ("cost_usd", "REAL"),
        ("input_tokens", "INTEGER"),
        ("output_tokens", "INTEGER"),
        ("commercial_model", "TEXT"),
        ("evidence_json", "TEXT"),
        ("document_name", "TEXT"),
        ("document_url", "TEXT"),
    ):
        try:
            conn.execute(f"ALTER TABLE processed_deals ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    return conn


def connect_pg():
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg
    except ImportError:
        print("psycopg not installed; skipping Neon write")
        return None
    try:
        return psycopg.connect(url, autocommit=True, connect_timeout=8)
    except Exception as exc:
        print(f"Neon skipped — {type(exc).__name__}")
        return None


def ensure_pg_schema(pg) -> None:
    if pg is None:
        return
    pg.execute(
        """
        CREATE TABLE IF NOT EXISTS ingest_progress (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION")
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS input_tokens INTEGER")
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS output_tokens INTEGER")
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS commercial_model TEXT")
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS evidence_json JSONB")
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS document_name TEXT")
    pg.execute("ALTER TABLE processed_deals ADD COLUMN IF NOT EXISTS document_url TEXT")


def build_evidence(
    deal: dict[str, Any],
    *,
    slot: str,
    email: str,
    doc: dict[str, Any] | None,
    document_url: str | None,
) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []
    for msg in (deal.get("messages") or [])[:40]:
        if not isinstance(msg, dict):
            continue
        body = msg.get("body_text") or msg.get("body") or ""
        if isinstance(body, str) and len(body) > 10_000:
            body = body[:10_000] + "\n\n[truncated]"
        atts = []
        for att in msg.get("attachments") or []:
            if isinstance(att, dict) and att.get("name"):
                entry: dict[str, Any] = {"name": att.get("name")}
                if att.get("url"):
                    entry["url"] = att.get("url")
                if att.get("path") or att.get("rel_path") or att.get("stored_path"):
                    entry["path"] = (
                        att.get("path")
                        or att.get("rel_path")
                        or att.get("stored_path")
                    )
                # Primary uploaded doc gets the live S3/presigned URL
                if document_url and doc and att.get("name") == doc.get("name"):
                    entry["url"] = document_url
                atts.append(entry)
        messages.append(
            {
                "id": msg.get("id") or msg.get("message_id"),
                "subject": msg.get("subject"),
                "from": msg.get("from") or msg.get("sender_email"),
                "from_name": msg.get("from_name") or msg.get("sender_name"),
                "to": msg.get("to"),
                "cc": msg.get("cc"),
                "bcc": msg.get("bcc"),
                "date": msg.get("date"),
                "body": body,
                "attachments": atts,
            }
        )
    return {
        "commercial_model": deal.get("commercial_model") or "agency_commission",
        "slot": slot,
        "email_text": (email or "")[:24_000],
        "document_name": (doc or {}).get("name"),
        "document_url": document_url,
        "messages": messages,
        "message_count": deal.get("message_count"),
        "doc_count": deal.get("doc_count"),
    }


def done_ids(pg=None) -> set[str]:
    found: set[str] = set()
    if RESULTS_PATH.exists():
        with RESULTS_PATH.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("id") and row.get("status") in {"completed", "skipped"}:
                    found.add(row["id"])
    if pg is not None:
        for rec in pg.execute(
            "SELECT id FROM processed_deals WHERE status IN ('completed', 'skipped')"
        ):
            found.add(rec[0])
    return found


def save_result(conn: sqlite3.Connection, row: dict[str, Any], pg=None) -> None:
    with RESULTS_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    conn.execute(
        """
        INSERT OR REPLACE INTO processed_deals (
          id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
          status, summary, confidence, date_start, date_end, message_count,
          doc_count, parties_json, result_json, error, processed_at,
          cost_usd, input_tokens, output_tokens, commercial_model,
          evidence_json, document_name, document_url
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            row.get("id"),
            json.dumps(row.get("po_numbers") or []),
            row.get("subject"),
            row.get("primary_stage"),
            row.get("slot"),
            row.get("agent_id"),
            row.get("execution_id"),
            row.get("status"),
            row.get("summary"),
            row.get("confidence"),
            row.get("date_start"),
            row.get("date_end"),
            row.get("message_count"),
            row.get("doc_count"),
            json.dumps(row.get("parties") or {}),
            json.dumps(row.get("result")),
            row.get("error"),
            row.get("processed_at"),
            row.get("cost_usd"),
            row.get("input_tokens"),
            row.get("output_tokens"),
            row.get("commercial_model"),
            json.dumps(row.get("evidence") or {}),
            row.get("document") or row.get("document_name"),
            row.get("document_url"),
        ),
    )
    conn.commit()
    if pg is None:
        return
    from psycopg.types.json import Jsonb

    try:
        pg.execute(
        """
        INSERT INTO processed_deals (
          id, po_numbers, subject, primary_stage, slot, agent_id, execution_id,
          status, summary, confidence, date_start, date_end, message_count,
          doc_count, parties_json, result_json, error, processed_at,
          cost_usd, input_tokens, output_tokens, commercial_model,
          evidence_json, document_name, document_url
        ) VALUES (
          %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s, %s
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
        (
            row.get("id"),
            Jsonb(row.get("po_numbers") or []),
            row.get("subject"),
            row.get("primary_stage"),
            row.get("slot"),
            row.get("agent_id"),
            row.get("execution_id"),
            row.get("status"),
            row.get("summary"),
            row.get("confidence"),
            row.get("date_start") or None,
            row.get("date_end") or None,
            row.get("message_count"),
            row.get("doc_count"),
            Jsonb(row.get("parties") or {}),
            Jsonb(row.get("result")),
            row.get("error"),
            row.get("processed_at") or None,
            row.get("cost_usd"),
            row.get("input_tokens"),
            row.get("output_tokens"),
            row.get("commercial_model"),
            Jsonb(row.get("evidence") or {}),
            row.get("document") or row.get("document_name"),
            row.get("document_url"),
        ),
    )
    except Exception as exc:
        print(f"Neon write skipped — {type(exc).__name__}")


def s3_bucket() -> str:
    return (os.environ.get("AWS_S3_BUCKET") or "").strip()


def s3_prefix() -> str:
    return (os.environ.get("AWS_S3_PREFIX") or "trade/pst-ingest").strip().strip("/")


def s3_region() -> str:
    return (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "ap-south-1").strip()


def safe_filename(name: str) -> str:
    base = Path(name).name or "document"
    cleaned = "".join(ch if ch.isalnum() or ch in ".-_" else "_" for ch in base)
    return (cleaned[:120] or "document").lstrip(".")


def upload_doc_s3(doc: dict[str, Any], data: bytes, content_type: str) -> str:
    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError("boto3 is required for S3 ingest uploads") from exc
    bucket = s3_bucket()
    digest = doc.get("sha256") or "nodigest"
    filename = safe_filename(doc.get("name") or "document")
    key = f"{s3_prefix()}/{digest}/{filename}"
    client = boto3.client("s3", region_name=s3_region())
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=S3_PRESIGN_SECONDS,
    )
    log(f"    uploaded s3://{bucket}/{key} ({len(data)} bytes)")
    return url


def multipart_body(
    fields: dict[str, str], filename: str, content: bytes, file_content_type: str
) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode()
        )
    chunks.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {file_content_type}\r\n\r\n"
        ).encode()
        + content
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def upload_doc_vibrium(token: str, filename: str, data: bytes, content_type: str) -> str:
    signed = unwrap(
        api_json(
            token,
            "POST",
            "uploads/presigned-url",
            {
                "filename": filename,
                "content_type": content_type,
                "folder": "trade/pst-ingest",
            },
        )
    )
    upload_url = signed.get("upload_url") or signed.get("url")
    fields = signed.get("fields") if isinstance(signed.get("fields"), dict) else {}
    max_size = signed.get("max_size_bytes")
    if max_size and len(data) > int(max_size):
        raise RuntimeError(f"file {len(data)} bytes exceeds upload cap {max_size}")
    if not upload_url:
        raise RuntimeError("presign missing upload_url")
    if fields:
        file_ct = str(fields.get("Content-Type") or content_type)
        body, header_ct = multipart_body(fields, filename, data, file_ct)
        req = urllib.request.Request(
            upload_url,
            data=body,
            method="POST",
            headers={"Content-Type": header_ct},
        )
    else:
        req = urllib.request.Request(
            upload_url,
            data=data,
            method="PUT",
            headers={"Content-Type": content_type},
        )
    with urllib.request.urlopen(req, timeout=180) as res:
        location = res.headers.get("Location") or ""
    host = urlparse(upload_url).hostname or ""
    key = fields.get("key") or signed.get("s3_key") or ""
    public_url = (
        signed.get("public_url")
        or location
        or (f"https://{host}/{key}" if host and key else "")
    )
    if not public_url:
        raise RuntimeError("upload succeeded but no document URL")
    log(f"    uploaded {filename} ({len(data)} bytes)")
    return public_url


def upload_doc(token: str, cache: dict[str, str], doc: dict[str, Any]) -> str | None:
    digest = doc.get("sha256")
    if digest and digest in cache:
        return cache[digest]
    path = local_doc_path(doc)
    if not path:
        return None
    filename = doc.get("name") or path.name
    data = path.read_bytes()
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if s3_bucket():
        public_url = upload_doc_s3(doc, data, content_type)
    else:
        public_url = upload_doc_vibrium(token, filename, data, content_type)
    if digest:
        cache[digest] = public_url
        CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    return public_url


def run_worker(token: str, agent_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    started = unwrap(
        api_json(
            token,
            "POST",
            "agent-executions",
            {"agent_id": agent_id, "input": payload},
        )
    )
    execution_id = started.get("execution_id") or started.get("id")
    if not execution_id:
        raise RuntimeError(f"no execution_id in {started}")
    t0 = time.time()
    log(f"    execution {execution_id}")
    deadline = t0 + POLL_TIMEOUT
    last_beat = t0
    while time.time() < deadline:
        ex = unwrap(api_json(token, "GET", f"agent-executions/{execution_id}"))
        status = ex.get("status")
        if status in {"completed", "failed", "cancelled", "timed_out"}:
            return ex
        now = time.time()
        if now - last_beat >= 15:
            log(f"    still running  {human_duration(now - t0)}")
            last_beat = now
        time.sleep(POLL_SECONDS)
    raise TimeoutError(f"execution {execution_id} timed out")


def execution_result(ex: dict[str, Any]) -> dict[str, Any] | None:
    payload = ex.get("result") or ex.get("output")
    if isinstance(payload, dict):
        return payload
    return None


def summary_from(result: dict[str, Any] | None) -> tuple[str | None, float | None]:
    if not result:
        return None, None
    summary = result.get("summary")
    if not isinstance(summary, str):
        summary = None
    conf = result.get("confidence")
    try:
        confidence = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        confidence = None
    return summary, confidence


# List rates used to turn worker usage into USD (per 1M tokens).
RATES_PER_MILLION = {
    "openai/gpt-4.1": {"input": 2.0, "output": 8.0, "cached": 0.5},
    "gemini/gemini-2.5-flash": {"input": 0.15, "output": 0.60, "cached": 0.0375},
}


def rates_for_model(name: str) -> dict[str, float] | None:
    if name in RATES_PER_MILLION:
        return RATES_PER_MILLION[name]
    lower = (name or "").lower()
    for key, rates in RATES_PER_MILLION.items():
        if key.split("/")[-1] in lower:
            return rates
    if "gpt-4.1" in lower:
        return RATES_PER_MILLION["openai/gpt-4.1"]
    if "gemini-2.5-flash" in lower or "gemini" in lower:
        return RATES_PER_MILLION["gemini/gemini-2.5-flash"]
    return None


def cost_from_execution(ex: dict[str, Any] | None) -> dict[str, Any]:
    empty = {
        "usd": 0.0,
        "input_tokens": 0,
        "output_tokens": 0,
        "source": "none",
        "breakdown": [],
    }
    if not ex:
        return empty
    by_model = ex.get("usage_by_model") or {}
    breakdown = []
    total = 0.0
    in_tok = 0
    out_tok = 0
    for key, block in by_model.items():
        if not isinstance(block, dict):
            continue
        rates = rates_for_model(key)
        inp = int(block.get("input_tokens") or 0)
        out = int(block.get("output_tokens") or 0)
        cached = min(inp, int(block.get("cached_tokens") or 0))
        in_tok += inp
        out_tok += out
        usd = 0.0
        if rates:
            uncached = max(0, inp - cached)
            usd = (
                uncached * rates["input"]
                + cached * rates["cached"]
                + out * rates["output"]
            ) / 1_000_000
            total += usd
        breakdown.append(
            {
                "model": key,
                "input_tokens": inp,
                "output_tokens": out,
                "cached_tokens": cached,
                "usd": round(usd, 6),
            }
        )
    if by_model:
        return {
            "usd": round(total, 6),
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "source": "metered",
            "breakdown": breakdown,
        }
    combined = ((ex.get("usage") or {}) if isinstance(ex.get("usage"), dict) else {}).get(
        "combined"
    ) or {}
    inp = int(combined.get("input_tokens") or 0)
    out = int(combined.get("output_tokens") or 0)
    if inp or out:
        rates = RATES_PER_MILLION["openai/gpt-4.1"]
        usd = (inp * rates["input"] + out * rates["output"]) / 1_000_000
        return {
            "usd": round(usd, 6),
            "input_tokens": inp,
            "output_tokens": out,
            "source": "estimated",
            "breakdown": [],
        }
    return empty


def process_deal(
    token: str,
    ids: dict[str, str],
    cache: dict[str, str],
    deal: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    slot = choose_slot(deal)
    agent_id = ids.get(slot) or ""
    doc = pick_document(deal, slot)
    email = clip_email(deal)
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": deal.get("id"),
        "po_numbers": deal.get("po_numbers") or [],
        "subject": deal.get("subject"),
        "primary_stage": deal.get("primary_stage"),
        "slot": slot,
        "agent_id": agent_id,
        "date_start": deal.get("date_start"),
        "date_end": deal.get("date_end"),
        "message_count": deal.get("message_count"),
        "doc_count": deal.get("doc_count"),
        "parties": deal.get("parties") or {},
        "processed_at": now,
        "commercial_model": deal.get("commercial_model") or "agency_commission",
    }

    def finish(
        updates: dict[str, Any],
        *,
        document_url: str | None = None,
    ) -> dict[str, Any]:
        row.update(updates)
        row["evidence"] = build_evidence(
            deal,
            slot=slot,
            email=email,
            doc=doc,
            document_url=document_url or row.get("document_url"),
        )
        if doc and not row.get("document"):
            row["document"] = doc.get("name")
        return row

    if not agent_id:
        return finish({"status": "skipped", "error": f"no agent id for {slot}"})
    if dry_run:
        return finish(
            {
                "status": "dry_run",
                "document": (doc or {}).get("name"),
                "email_chars": len(email),
                "would_skip": bool(slot in DOC_REQUIRED and not doc),
            }
        )

    if slot in DOC_REQUIRED and not doc:
        return finish(
            {
                "status": "skipped",
                "error": "missing_document_for_doc_worker",
            }
        )

    document_url = None
    if slot in DOC_REQUIRED and doc:
        document_url = upload_doc(token, cache, doc)
    if slot in DOC_REQUIRED and not document_url:
        return finish(
            {
                "status": "skipped",
                "error": "upload_failed_for_doc_worker",
                "document": (doc or {}).get("name"),
            }
        )

    context = deal_context_notes(deal)
    model = deal.get("commercial_model") or "agency_commission"
    payload: dict[str, Any]
    if slot in DOC_REQUIRED:
        payload = {
            "document_url": document_url,
            "notes": (context + "\n\n" + email[:7000])[:9000],
        }
        if slot == "inspection_photo_summarizer":
            pos = deal.get("po_numbers") or []
            if pos:
                payload["po_number"] = str(pos[0])
    elif slot in DOC_OPTIONAL:
        payload = {
            "email_text": (context + "\n\n" + email)[:EMAIL_CHAR_LIMIT],
            "notes": context[:2000],
        }
        if document_url:
            payload["document_url"] = document_url
        elif doc:
            # best-effort upload for dual-input slots
            document_url = upload_doc(token, cache, doc)
            if document_url:
                payload["document_url"] = document_url
    elif slot == "requirement_extractor":
        payload = {
            "email_text": (context + "\n\n" + email)[:EMAIL_CHAR_LIMIT],
            "agency_context": context[:2000],
        }
    else:
        # Most email workers only allow email_text (+ optional notes on some)
        payload = {
            "email_text": (context + "\n\n" + email)[:EMAIL_CHAR_LIMIT],
        }
        if slot in {"payment_clock", "commission_checklist", "sample_request_summarizer", "production_status_extractor"}:
            payload["notes"] = context[:2000]

    ex = run_worker(token, agent_id, payload)
    result = execution_result(ex)
    summary, confidence = summary_from(result)
    # Agent gate: skip only clear travel/admin noise
    if isinstance(result, dict) and result.get("isTradeDeal") is False:
        reason = str(result.get("rejectReason") or summary or "").lower()
        noise_hit = any(
            token in reason
            for token in (
                "hotel",
                "agoda",
                "airline",
                "e-ticket",
                "eticket",
                "flight",
                "expo booth",
                "plant renewal",
                "personal travel",
                "not freight",
                "not a freight",
                "membership",
                "appa",
                "interzoo",
                "admin ledger",
                "global ledger",
            )
        )
        if noise_hit:
            return finish(
                {
                    "status": "skipped",
                    "error": f"not_a_trade_deal: {result.get('rejectReason') or summary or 'agent rejected'}",
                    "result": result,
                    "summary": summary,
                    "confidence": confidence,
                    "document": (doc or {}).get("name"),
                    "document_url": document_url,
                    "commercial_model": model,
                },
                document_url=document_url,
            )
    row.update(
        {
            "status": ex.get("status") or "unknown",
            "execution_id": ex.get("execution_id") or ex.get("id"),
            "result": result,
            "summary": summary,
            "confidence": confidence,
            "document": (doc or {}).get("name"),
            "document_url": document_url,
            "commercial_model": model,
        }
    )
    if row["status"] != "completed":
        row["error"] = json.dumps(ex.get("error") or ex.get("message") or ex)[:1000]
    cost = cost_from_execution(ex)
    row["cost_usd"] = cost["usd"]
    row["input_tokens"] = cost["input_tokens"]
    row["output_tokens"] = cost["output_tokens"]
    row["cost_source"] = cost["source"]
    row["cost_breakdown"] = cost["breakdown"]
    return finish({}, document_url=document_url)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--deals",
        type=Path,
        help="Deal pack to process instead of data/pst_extract/relevant/deals.jsonl",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stage", help="Only this primary_stage")
    parser.add_argument(
        "--ids",
        help="Comma-separated deal ids (smoke test). Does not spend on the rest.",
    )
    parser.add_argument(
        "--ids-file",
        help="Newline-separated deal ids file (safer than --ids for topic:… names).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-process even if id already in local/Neon done set (smoke / rerun).",
    )
    parser.add_argument(
        "--with-docs",
        action="store_true",
        help="Only deals with a pickable local attachment (newest first).",
    )
    args = parser.parse_args()
    deals_path = args.deals or DEALS_PATH
    if not deals_path.exists():
        raise SystemExit(f"Missing {deals_path}; run build_relevant_deals.py first")

    load_env()
    pg = connect_pg()
    if pg is None:
        log("Neon skipped — DATABASE_URL missing")
    else:
        ensure_pg_schema(pg)
        log("Neon connected")
    if s3_bucket():
        log(f"S3 ingest s3://{s3_bucket()}/{s3_prefix()} ({s3_region()})")
    else:
        log("S3 ingest skipped — AWS_S3_BUCKET missing")
    done = set() if args.force else done_ids(pg)
    ids = load_ids()
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}
    conn = init_db()
    token = ""
    if args.dry_run:
        log("Dry run — no uploads, no LLM")
    else:
        token = mint_token()
        log("Vibrium auth ok")

    want_ids = {part.strip() for part in (args.ids or "").split(",") if part.strip()}
    if args.ids_file:
        for line in Path(args.ids_file).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                want_ids.add(line)
    target = count_pending(
        done, args.stage, args.limit, with_docs=args.with_docs, source=deals_path if args.deals else None
    )
    if want_ids:
        target = min(target if not args.force else len(want_ids), len(want_ids))
        if args.force:
            target = len(want_ids)
    processed = 0
    failed = 0
    run_cost = 0.0
    run_in_tok = 0
    run_out_tok = 0
    started = time.time()
    started_at = datetime.now().astimezone()
    progress: dict[str, Any] = {
        "running": True,
        "limit": args.limit,
        "stage": args.stage,
        "with_docs": args.with_docs,
        "target": target,
        "completed": 0,
        "failed": 0,
        "already_done": len(done),
        "started_at": started_at.isoformat(),
        "elapsed_s": 0,
        "eta_s": None,
        "etd": None,
        "rate_per_min": 0,
        "cost_usd": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_note": "List rates: GPT-4.1 $2/$8 per 1M in/out; Gemini 2.5 Flash $0.15/$0.60. Metered from worker usage.",
        "current": None,
        "last": None,
    }
    write_progress(progress, pg)
    log(
        f"Queue {target}  already done {len(done)}"
        + (f"  stage {args.stage}" if args.stage else "")
        + (f"  limit {args.limit}" if args.limit else "")
        + ("  with-docs" if args.with_docs else "")
    )

    def snapshot(
        current: dict[str, Any] | None = None,
        last: dict[str, Any] | None = None,
    ) -> None:
        elapsed = time.time() - started
        finished = processed + failed
        rate = finished / elapsed if elapsed else 0
        remaining = max(0, target - finished)
        eta_s = remaining / rate if rate and remaining else (0 if remaining == 0 else None)
        etd = (
            (datetime.now().astimezone() + timedelta(seconds=eta_s)).isoformat()
            if eta_s is not None
            else None
        )
        progress.update(
            {
                "completed": processed,
                "failed": failed,
                "elapsed_s": round(elapsed, 1),
                "eta_s": None if eta_s is None else round(eta_s, 1),
                "etd": etd,
                "rate_per_min": round(rate * 60, 2),
                "cost_usd": round(run_cost, 6),
                "input_tokens": run_in_tok,
                "output_tokens": run_out_tok,
                "current": current,
                "last": last if last is not None else progress.get("last"),
            }
        )
        write_progress(progress, pg)

    try:
        with deals_path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                deal = json.loads(line)
                if args.stage and deal.get("primary_stage") != args.stage:
                    continue
                if want_ids and deal.get("id") not in want_ids:
                    continue
                if deal.get("id") in done:
                    continue
                if args.with_docs and not pick_document(deal):
                    continue
                if args.limit is not None and processed + failed >= args.limit:
                    break
                n = processed + failed + 1
                # Vibrium bearer tokens expire mid-run; refresh periodically.
                if (
                    not args.dry_run
                    and token
                    and (processed + failed) > 0
                    and (processed + failed) % 15 == 0
                ):
                    token = mint_token()
                    log("Vibrium token refreshed")
                subject = (deal.get("subject") or deal.get("id") or "")[:70]
                slot = choose_slot(deal)
                deal_t0 = time.time()
                log(f"→ [{n}/{target}] {deal.get('primary_stage') or '-'}  {slot}  {subject}")
                snapshot(
                    current={
                        "n": n,
                        "id": deal.get("id"),
                        "subject": subject,
                        "stage": deal.get("primary_stage"),
                        "slot": slot,
                        "status": "running",
                    }
                )
                try:
                    row = process_deal(token or "", ids, cache, deal, args.dry_run)
                except Exception as exc:
                    err_text = f"{type(exc).__name__}: {exc}"
                    if (
                        not args.dry_run
                        and token
                        and ("403" in err_text or "Forbidden" in err_text)
                    ):
                        try:
                            token = mint_token()
                            log("Vibrium token refreshed after 403; retrying deal")
                            row = process_deal(token, ids, cache, deal, args.dry_run)
                        except Exception as retry_exc:
                            err_text = f"{type(retry_exc).__name__}: {retry_exc}"
                            row = {
                                "id": deal.get("id"),
                                "subject": deal.get("subject"),
                                "primary_stage": deal.get("primary_stage"),
                                "slot": slot,
                                "status": "failed",
                                "error": err_text,
                                "processed_at": datetime.now(timezone.utc).isoformat(),
                                "po_numbers": deal.get("po_numbers") or [],
                                "parties": deal.get("parties") or {},
                                "message_count": deal.get("message_count"),
                                "doc_count": deal.get("doc_count"),
                                "date_start": deal.get("date_start"),
                                "date_end": deal.get("date_end"),
                            }
                        else:
                            err_text = ""
                    if err_text:
                        row = {
                            "id": deal.get("id"),
                            "subject": deal.get("subject"),
                            "primary_stage": deal.get("primary_stage"),
                            "slot": slot,
                            "status": "failed",
                            "error": err_text,
                            "processed_at": datetime.now(timezone.utc).isoformat(),
                            "po_numbers": deal.get("po_numbers") or [],
                            "parties": deal.get("parties") or {},
                            "message_count": deal.get("message_count"),
                            "doc_count": deal.get("doc_count"),
                            "date_start": deal.get("date_start"),
                            "date_end": deal.get("date_end"),
                        }
                if not args.dry_run:
                    save_result(conn, row, pg)
                deal_cost = float(row.get("cost_usd") or 0)
                run_cost += deal_cost
                run_in_tok += int(row.get("input_tokens") or 0)
                run_out_tok += int(row.get("output_tokens") or 0)
                if row.get("status") in {"completed", "skipped", "dry_run"}:
                    processed += 1
                else:
                    failed += 1
                elapsed = time.time() - started
                finished = processed + failed
                rate = finished / elapsed if elapsed else 0
                remaining = max(0, target - finished)
                eta_s = remaining / rate if rate and remaining else 0
                etd_local = datetime.now().astimezone() + timedelta(seconds=eta_s)
                deal_s = time.time() - deal_t0
                log(
                    f"  {row.get('status')}  {human_duration(deal_s)}  "
                    f"elapsed {human_duration(elapsed)}  "
                    f"ETA {human_duration(eta_s)}  "
                    f"ETD {etd_local.strftime('%H:%M')}  "
                    f"{rate * 60:.1f}/min  "
                    f"${deal_cost:.4f}  run ${run_cost:.4f}"
                )
                if args.dry_run and row.get("document"):
                    log(f"    doc {row['document']}")
                snapshot(
                    current=None,
                    last={
                        "n": n,
                        "id": row.get("id"),
                        "subject": subject,
                        "stage": row.get("primary_stage"),
                        "slot": row.get("slot"),
                        "status": row.get("status"),
                        "seconds": round(deal_s, 1),
                    },
                )
    finally:
        progress["running"] = False
        snapshot(current=None)
        if pg is not None:
            pg.close()

    log(
        f"\nDone  processed {processed}  failed {failed}  already_done {len(done)}  "
        f"{human_duration(time.time() - started)}  cost ${run_cost:.4f}"
    )
    if not args.dry_run:
        log(f"  results {RESULTS_PATH}")
        log(f"  sqlite  {DB_PATH}")
        log("  neon    " + ("written" if pg is not None else "skipped"))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
