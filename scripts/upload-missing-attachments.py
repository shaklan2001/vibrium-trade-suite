#!/usr/bin/env python3
"""Upload PST attachment digests to S3 ingest (trade/pst-ingest/{sha256}/…).

Scans all data/pst_extract/*/attachments trees. Skips digests already in
upload-cache.json or already present in S3. Updates the cache as it goes.

  scripts/pst-extract/.venv/bin/python scripts/upload-missing-attachments.py
  scripts/pst-extract/.venv/bin/python scripts/upload-missing-attachments.py --only f22be3a4…
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEVANT = ROOT / "data/pst_extract/relevant"
CACHE_PATH = RELEVANT / "upload-cache.json"
ATT_ROOTS = sorted(ROOT.glob("data/pst_extract/*/attachments"))

BUCKET = os.environ.get("AWS_S3_BUCKET", "conversation-agents-artifacts")
PREFIX = (os.environ.get("AWS_S3_PREFIX") or "trade/pst-ingest").strip("/")
REGION = os.environ.get("AWS_REGION", "ap-south-1")


def safe_filename(name: str) -> str:
    base = Path(name or "document").name
    cleaned = "".join(ch if ch.isalnum() or ch in ".-_" else "_" for ch in base)
    return (cleaned[:120] or "document").lstrip(".")


def digest_of(path: Path) -> str | None:
    stem = path.stem
    dig = stem[:64].lower()
    if len(dig) == 64 and all(c in "0123456789abcdef" for c in dig):
        return dig
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only",
        nargs="*",
        default=[],
        help="Optional digest prefixes/full digests to upload first",
    )
    parser.add_argument("--limit", type=int, default=0, help="Max new uploads (0=all)")
    parser.add_argument(
        "--skip-head",
        action="store_true",
        help="Do not HEAD S3 before upload (faster, may overwrite)",
    )
    args = parser.parse_args()

    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        print("boto3 required (use scripts/pst-extract/.venv)", file=sys.stderr)
        return 1

    if not ATT_ROOTS:
        print("no attachment roots under data/pst_extract/*/attachments", file=sys.stderr)
        return 1

    RELEVANT.mkdir(parents=True, exist_ok=True)
    cache: dict[str, str] = {}
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text())

    # digest -> best local path
    local: dict[str, Path] = {}
    for root in ATT_ROOTS:
        for f in root.rglob("*"):
            if not f.is_file():
                continue
            dig = digest_of(f)
            if not dig:
                continue
            prev = local.get(dig)
            if prev is None or f.stat().st_size > prev.stat().st_size:
                local[dig] = f

    only = [o.lower() for o in (args.only or [])]
    digests = sorted(local)
    if only:
        digests = [
            d
            for d in digests
            if any(d.startswith(o) or o.startswith(d) or d == o for o in only)
        ]

    client = boto3.client("s3", region_name=REGION)
    uploaded = 0
    skipped_cached = 0
    skipped_remote = 0
    errors = 0
    bytes_up = 0

    print(
        f"local_digests={len(local)} candidates={len(digests)} "
        f"cached={len(cache)} roots={[str(r.relative_to(ROOT)) for r in ATT_ROOTS]} "
        f"bucket={BUCKET}/{PREFIX}"
    )

    for i, digest in enumerate(digests, 1):
        if args.limit and uploaded >= args.limit:
            break
        local_path = local[digest]
        if digest in cache and not only:
            skipped_cached += 1
            continue

        key_prefix = f"{PREFIX}/{digest}/"
        if not args.skip_head and not only:
            try:
                listed = client.list_objects_v2(
                    Bucket=BUCKET, Prefix=key_prefix, MaxKeys=1
                )
                if listed.get("KeyCount"):
                    key = listed["Contents"][0]["Key"]
                    cache[digest] = f"https://{BUCKET}.s3.amazonaws.com/{key}"
                    skipped_remote += 1
                    if skipped_remote % 200 == 0:
                        CACHE_PATH.write_text(json.dumps(cache, indent=0))
                        print(f"  scanned remote-existing={skipped_remote}")
                    continue
            except ClientError as exc:
                print(f"HEAD/LIST fail {digest[:12]} {exc}", file=sys.stderr)

        filename = safe_filename(local_path.name)
        if "." not in filename and local_path.suffix:
            filename = safe_filename(filename + local_path.suffix)
        # Prefer original extension from content-addressed filename
        if local_path.suffix and not filename.lower().endswith(local_path.suffix.lower()):
            filename = safe_filename(Path(filename).stem + local_path.suffix)

        key = f"{PREFIX}/{digest}/{filename}"
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        data = local_path.read_bytes()
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

        if uploaded % 25 == 0 or (only and uploaded == len(digests)):
            CACHE_PATH.write_text(json.dumps(cache, indent=0))
            print(
                f"  uploaded={uploaded} ({bytes_up/1e6:.1f} MB) "
                f"cached_skip={skipped_cached} remote_skip={skipped_remote} "
                f"errors={errors} progress={i}/{len(digests)}"
            )

    CACHE_PATH.write_text(json.dumps(cache, indent=0))
    print(
        f"done uploaded={uploaded} cached_skip={skipped_cached} "
        f"remote_skip={skipped_remote} errors={errors} "
        f"cache={len(cache)} bytes={bytes_up}"
    )
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
