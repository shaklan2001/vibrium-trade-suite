#!/usr/bin/env python3
"""Backfill attachments for selected message ids already present in messages.jsonl.

Resume-based extract.py skips existing messages, so this walks the PST again and
only writes attachment bytes + patches matching rows in messages.jsonl.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

try:
    import pypff
except ImportError:
    sys.stderr.write("pypff missing; use scripts/pst-extract/.venv\n")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from extract import (  # noqa: E402
    as_int,
    as_str,
    call,
    disk_free,
    extract_message,
    human_bytes,
    human_int,
    iter_sub_messages,
    load_attachment_hashes,
    should_skip_folder,
    walk_folders,
)

MIN_FREE = 8 * 1024 * 1024 * 1024

MAILBOX_PSTS = {
    "outlook_sep_2025_2026": Path(
        "/Users/piyushjha/Downloads/OUTLOOK SEP 2025-2026.pst"
    ),
    "outlook_sep_2025_2026_nimisha": Path(
        "/Users/piyushjha/Downloads/outlook sep 2025 - 2026 nimisha.pst"
    ),
    "inspection_oulook_2025_26": Path(
        "/Users/piyushjha/Downloads/Inspection_Oulook_2025-26.pst"
    ),
}


def collect_targets(deals_path: Path, limit: int | None) -> dict[str, set[str]]:
    deals: list[dict[str, Any]] = []
    with deals_path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                deals.append(json.loads(line))
    deals.sort(key=lambda d: d.get("date_end") or "", reverse=True)
    if limit is not None:
        deals = deals[:limit]
    by_mailbox: dict[str, set[str]] = {}
    for deal in deals:
        for msg in deal.get("messages") or []:
            mid = str(msg.get("id") or "")
            mailbox = str(msg.get("mailbox") or "")
            if not mid or not mailbox:
                continue
            by_mailbox.setdefault(mailbox, set()).add(mid)
    return by_mailbox


def backfill_mailbox(
    mailbox: str,
    pst_path: Path,
    out_root: Path,
    wanted: set[str],
    max_attachment_mb: float,
) -> dict[str, Any]:
    out_dir = out_root / mailbox
    messages_path = out_dir / "messages.jsonl"
    attachments_path = out_dir / "attachments.jsonl"
    attachments_dir = out_dir / "attachments"
    if not messages_path.exists():
        raise SystemExit(f"missing {messages_path}")
    if not pst_path.exists():
        raise SystemExit(f"missing PST {pst_path}")

    rows: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    with messages_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            rid = row["id"]
            rows[rid] = row
            order.append(rid)

    need = {mid for mid in wanted if mid in rows}
    already = {
        mid
        for mid in need
        if any(
            (a.get("path") or a.get("sha256")) and not a.get("skipped")
            for a in (rows[mid].get("attachments") or [])
        )
    }
    todo = need - already
    print(
        f"\n== {mailbox} == need {len(need)}  already_have_docs {len(already)}  todo {len(todo)}"
    )
    if not todo:
        return {
            "mailbox": mailbox,
            "need": len(need),
            "updated": 0,
            "already": len(already),
        }

    attachments_dir.mkdir(parents=True, exist_ok=True)
    seen_hashes = (
        load_attachment_hashes(attachments_path) if attachments_path.exists() else set()
    )
    max_bytes = None if max_attachment_mb <= 0 else int(max_attachment_mb * 1024 * 1024)
    archive = pypff.file()
    archive.open(str(pst_path))
    updated = 0
    errors = 0
    att_files = 0
    att_bytes = 0
    started = time.time()
    try:
        folders = walk_folders(archive.get_root_folder())
        with attachments_path.open("a", encoding="utf-8") as attachments_handle:
            for folder_path, folder, _count in folders:
                if should_skip_folder(folder_path, include_junk=False):
                    continue
                free = disk_free(out_dir)
                if free < MIN_FREE:
                    raise SystemExit(
                        f"Disk below {human_bytes(MIN_FREE)} ({human_bytes(free)} free); stop."
                    )
                for msg in iter_sub_messages(folder):
                    ident = as_str(call(msg, "get_identifier", "identifier"))
                    row_id = f"{mailbox}:{ident}" if ident else None
                    if not row_id or row_id not in todo:
                        continue
                    try:
                        row = extract_message(
                            msg,
                            mailbox=mailbox,
                            folder_path=folder_path,
                            attachments_dir=attachments_dir,
                            attachments_jsonl=attachments_handle,
                            seen_hashes=seen_hashes,
                            skip_attachments=False,
                            max_attachment_bytes=max_bytes,
                        )
                        # Keep previously extracted body/headers; replace attachment fields.
                        prev = rows[row_id]
                        prev["attachments"] = row.get("attachments") or []
                        prev["attachment_count"] = row.get("attachment_count") or len(
                            prev["attachments"]
                        )
                        rows[row_id] = prev
                        updated += 1
                        for att in prev["attachments"]:
                            if att.get("path") and not att.get("skipped"):
                                att_files += 1
                                att_bytes += as_int(att.get("size"))
                        if updated % 25 == 0:
                            print(
                                f"  updated {human_int(updated)}/{human_int(len(todo))}  "
                                f"atts {human_int(att_files)} ({human_bytes(att_bytes)})  "
                                f"disk {human_bytes(disk_free(out_dir))}  "
                                f"elapsed {int(time.time()-started)}s",
                                flush=True,
                            )
                    except Exception as exc:
                        errors += 1
                        print(f"  error {row_id}: {type(exc).__name__}: {exc}")
                    if updated >= len(todo):
                        break
                if updated >= len(todo):
                    break
    finally:
        archive.close()

    tmp = messages_path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for rid in order:
            handle.write(json.dumps(rows[rid], ensure_ascii=False) + "\n")
    tmp.replace(messages_path)
    print(
        f"  done updated={updated} errors={errors} att_files={att_files} "
        f"att_bytes={human_bytes(att_bytes)} elapsed={int(time.time()-started)}s"
    )
    return {
        "mailbox": mailbox,
        "need": len(need),
        "updated": updated,
        "errors": errors,
        "attachment_files": att_files,
        "attachment_bytes": att_bytes,
        "already": len(already),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--deals",
        type=Path,
        required=True,
        help="deals.jsonl / queue.jsonl whose message ids should get attachments",
    )
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "pst_extract")
    parser.add_argument("--limit", type=int, help="Only newest N deals from --deals")
    parser.add_argument("--max-attachment-mb", type=float, default=40.0)
    parser.add_argument("--mailbox", action="append", help="Restrict to mailbox slug(s)")
    args = parser.parse_args()

    targets = collect_targets(args.deals, args.limit)
    if args.mailbox:
        allow = set(args.mailbox)
        targets = {k: v for k, v in targets.items() if k in allow}
    print(
        json.dumps(
            {
                "deals": str(args.deals),
                "mailboxes": {k: len(v) for k, v in targets.items()},
                "disk_free": human_bytes(disk_free(args.output)),
            },
            indent=2,
        )
    )
    summary = []
    for mailbox, wanted in targets.items():
        pst = MAILBOX_PSTS.get(mailbox)
        if not pst:
            print(f"skip unknown mailbox {mailbox}")
            continue
        summary.append(
            backfill_mailbox(
                mailbox,
                pst,
                args.output,
                wanted,
                args.max_attachment_mb,
            )
        )
    print(json.dumps({"summary": summary}, indent=2))


if __name__ == "__main__":
    main()
