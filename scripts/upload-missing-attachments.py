#!/usr/bin/env python3
"""Upload PST attachment digests referenced by processed deals to S3 ingest.

Skips digests already in upload-cache.json. Updates the cache as it goes.

  AWS_BIN=/tmp/awscli-venv/bin/aws \\
    scripts/pst-extract/.venv/bin/python scripts/upload-missing-attachments.py
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEVANT = ROOT / "data/pst_extract/relevant"
DEALS = RELEVANT / "deals.jsonl"
SQLITE = RELEVANT / "processed.db"
CACHE_PATH = RELEVANT / "upload-cache.json"
ATT_ROOTS = [
    ROOT / "data/pst_extract/outlook_sep_2025_2026_rakesh/attachments",
    ROOT / "data/pst_extract/kalpana_at_snspl_in_outlook/attachments",
]

DIGEST_RE = re.compile(r"(?:^|/)([a-f0-9]{64})(?:\.[a-z0-9]+)?$", re.I)
BUCKET = os.environ.get("AWS_S3_BUCKET", "conversation-agents-artifacts")
PREFIX = (os.environ.get("AWS_S3_PREFIX") or "trade/pst-ingest").strip("/")
REGION = os.environ.get("AWS_REGION", "ap-south-1")


def safe_filename(name: str) -> str:
    base = Path(name or "document").name
    cleaned = "".join(ch if ch.isalnum() or ch in ".-_" else "_" for ch in base)
    return (cleaned[:120] or "document").lstrip(".")


def main() -> int:
    try:
        import boto3
    except ImportError:
        print("boto3 required (use scripts/pst-extract/.venv)", file=sys.stderr)
        return 1

    if not SQLITE.exists() or not DEALS.exists():
        print("missing processed.db or deals.jsonl", file=sys.stderr)
        return 1

    ids = {
        r[0]
        for r in sqlite3.connect(str(SQLITE)).execute("SELECT id FROM processed_deals")
    }
    cache: dict[str, str] = {}
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text())

    needed: dict[str, str] = {}
    for line in DEALS.open(encoding="utf-8"):
        if not line.strip():
            continue
        deal = json.loads(line)
        if deal.get("id") not in ids:
            continue
        for msg in deal.get("messages") or []:
            for att in msg.get("attachments") or []:
                path = (
                    att.get("path")
                    or att.get("rel_path")
                    or att.get("stored_path")
                    or ""
                )
                m = DIGEST_RE.search(path)
                if not m:
                    continue
                digest = m.group(1).lower()
                if digest in cache:
                    continue
                if digest not in needed:
                    needed[digest] = att.get("name") or Path(path).name or digest

    client = boto3.client("s3", region_name=REGION)
    uploaded = 0
    skipped_missing = 0
    errors = 0
    bytes_up = 0

    items = sorted(needed.items())
    print(f"to_upload={len(items)} already_cached={len(cache)} bucket={BUCKET}/{PREFIX}")

    for i, (digest, name) in enumerate(items, 1):
        local = None
        for root in ATT_ROOTS:
            cands = list(root.glob(f"{digest[:2]}/{digest[2:4]}/{digest}.*"))
            if cands:
                local = cands[0]
                break
        if local is None:
            skipped_missing += 1
            continue

        filename = safe_filename(name or local.name)
        # Prefer local extension if name lacks one
        if "." not in filename and local.suffix:
            filename = safe_filename(filename + local.suffix)
        key = f"{PREFIX}/{digest}/{filename}"
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        data = local.read_bytes()
        try:
            client.put_object(
                Bucket=BUCKET,
                Key=key,
                Body=data,
                ContentType=ctype,
            )
            url = f"https://{BUCKET}.s3.amazonaws.com/{key}"
            cache[digest] = url
            uploaded += 1
            bytes_up += len(data)
        except Exception as exc:
            errors += 1
            print(f"FAIL {digest[:12]} {exc}", file=sys.stderr)
            continue

        if uploaded % 25 == 0 or i == len(items):
            CACHE_PATH.write_text(json.dumps(cache, indent=0))
            print(
                f"  {uploaded}/{len(items)} uploaded "
                f"({bytes_up/1e6:.1f} MB) missing_local={skipped_missing} errors={errors}"
            )

    CACHE_PATH.write_text(json.dumps(cache, indent=0))
    print(
        f"done uploaded={uploaded} missing_local={skipped_missing} "
        f"errors={errors} cache={len(cache)} bytes={bytes_up}"
    )
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
