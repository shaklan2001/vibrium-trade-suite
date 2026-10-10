#!/usr/bin/env python3
"""Repair extracted PST attachments locally: magic-byte types + Outlook filenames.

Does not re-extract file bytes. Reads existing files under data/pst_extract,
renames them with real extensions, and (optionally) walks the original PST
only to recover MAPI long filenames / MIME types.

Usage:
  python repair_attachments.py --scan-only
  python repair_attachments.py
  python repair_attachments.py --no-pst
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from pstutil import (  # noqa: E402
    OutlookAttach,
    Sniff,
    display_name,
    find_hashed_file,
    is_likely_inline,
    outlook_attachment_meta,
    sniff_file,
)

try:
    import pypff
except ImportError:
    pypff = None  # type: ignore

DEFAULT_OUTPUT = ROOT / "data" / "pst_extract"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
CLEAR_LINE = "\033[2K"
MOVE_UP = "\033[F"


def human_int(n: int) -> str:
    return f"{n:,}"


def human_duration(seconds: float | None) -> str:
    if seconds is None or seconds < 0 or seconds == float("inf"):
        return "unknown"
    total = int(seconds)
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}h {minutes:02d}m {secs:02d}s"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def render_bar(done: int, total: int, width: int = 32) -> str:
    if total <= 0:
        return "░" * width
    frac = min(1.0, max(0.0, done / total))
    filled = int(round(width * frac))
    return "█" * filled + "░" * (width - filled)


class Progress:
    def __init__(self) -> None:
        self.enabled = sys.stderr.isatty()
        self.printed = False

    def start(self) -> None:
        if self.enabled:
            sys.stderr.write(HIDE_CURSOR)

    def render(self, line1: str, line2: str) -> None:
        if not self.enabled:
            sys.stderr.write(line1 + "\n")
            return
        if self.printed:
            sys.stderr.write(MOVE_UP * 2)
        for line in (line1, line2):
            sys.stderr.write(f"{CLEAR_LINE}\r{line}\n")
        sys.stderr.flush()
        self.printed = True

    def finish(self) -> None:
        if self.enabled:
            sys.stderr.write(SHOW_CURSOR)
            sys.stderr.flush()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def mailbox_dirs(output: Path, only: str | None) -> list[Path]:
    dirs = sorted(
        [
            p
            for p in output.iterdir()
            if p.is_dir() and (p / "attachments.jsonl").exists()
        ]
    )
    if only:
        dirs = [p for p in dirs if p.name == only]
    if not dirs:
        raise SystemExit(f"No extracted mailboxes in {output}")
    return dirs


def sniff_mailbox(out_dir: Path, apply: bool) -> dict[str, Any]:
    attachments_dir = out_dir / "attachments"
    catalog_path = out_dir / "attachments.jsonl"
    rows: list[dict[str, Any]] = []
    kinds: Counter[str] = Counter()
    renamed = 0
    missing = 0
    already = 0
    started = time.time()
    progress = Progress()
    progress.start()

    with catalog_path.open(encoding="utf-8") as handle:
        catalog = [json.loads(line) for line in handle if line.strip()]
    total = len(catalog)
    by_hash: dict[str, dict[str, Any]] = {}

    try:
        for i, row in enumerate(catalog, start=1):
            digest = row.get("sha256")
            if not digest:
                continue
            path = find_hashed_file(attachments_dir, digest)
            if path is None:
                missing += 1
                continue
            sniff = sniff_file(path)
            kinds[sniff.kind] += 1
            new_name = path.name if path.suffix else f"{digest}{sniff.ext}"
            dest = path.with_name(new_name)
            if apply and dest != path:
                if dest.exists() and dest != path:
                    path.unlink()
                else:
                    path.rename(dest)
                renamed += 1
                path = dest
            elif path.suffix:
                already += 1
            rel = str(path.relative_to(attachments_dir)).replace("\\", "/")
            updated = {
                **row,
                "path": rel,
                "kind": sniff.kind,
                "ext": sniff.ext,
                "sniff_mime": sniff.mime,
            }
            rows.append(updated)
            by_hash[digest] = updated
            if i % 50 == 0 or i == total:
                elapsed = time.time() - started
                rate = i / elapsed if elapsed else 0
                eta = (total - i) / rate if rate else None
                progress.render(
                    f"{render_bar(i, total)}  {i / total * 100:5.1f}%  {human_int(i)}/{human_int(total)} files  {rate:.0f}/s  ETA {human_duration(eta)}",
                    f"{out_dir.name}  sniff  renamed {human_int(renamed)}  already typed {human_int(already)}  missing {human_int(missing)}",
                )
    finally:
        progress.finish()

    return {
        "rows": rows,
        "by_hash": by_hash,
        "kinds": kinds,
        "renamed": renamed,
        "already": already,
        "missing": missing,
        "seconds": round(time.time() - started, 1),
    }


def recover_names_from_pst(
    out_dir: Path,
    by_hash: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if pypff is None:
        raise SystemExit("pypff missing; use --no-pst or install libpff-python")
    source = load_json(out_dir / "source.json")
    pst_path = Path(source["path"])
    if not pst_path.exists():
        raise SystemExit(f"Original PST not found: {pst_path}")

    # Reuse folder walk from extract.py (same mailbox layout).
    from extract import iter_sub_messages, should_skip_folder, walk_folders

    named = 0
    inline = 0
    messages = 0
    started = time.time()
    progress = Progress()
    progress.start()
    index: dict[tuple[str, int], dict[str, Any]] = {}

    archive = pypff.file()
    archive.open(str(pst_path))
    try:
        folders = walk_folders(archive.get_root_folder())
        target = sum(count for _p, _f, count in folders)
        for folder_path, folder, _count in folders:
            if should_skip_folder(folder_path, include_junk=False):
                continue
            for msg in iter_sub_messages(folder):
                messages += 1
                ident = str(getattr(msg, "identifier", None) or "")
                try:
                    n_att = int(msg.get_number_of_attachments() or 0)
                except Exception:
                    n_att = 0
                for i in range(n_att):
                    try:
                        att = msg.get_attachment(i)
                        meta = outlook_attachment_meta(att)
                    except Exception:
                        continue
                    if not (meta.name or meta.mime or meta.content_id):
                        continue
                    index[(ident, i)] = {
                        "name": meta.name,
                        "short_name": meta.short_name,
                        "mime": meta.mime,
                        "content_id": meta.content_id,
                        "inline": is_likely_inline(meta.name, meta.mime, meta.content_id),
                    }
                    named += 1
                    if index[(ident, i)]["inline"]:
                        inline += 1
                if messages % 40 == 0:
                    elapsed = time.time() - started
                    rate = messages / elapsed if elapsed else 0
                    eta = (target - messages) / rate if rate and target else None
                    progress.render(
                        f"{render_bar(messages, target or 1)}  {min(100, messages / max(target, 1) * 100):5.1f}%  {human_int(messages)} msgs  {rate:.0f}/s  ETA {human_duration(eta)}",
                        f"{out_dir.name}  MAPI names {human_int(named)}  inline {human_int(inline)}",
                    )
    finally:
        try:
            archive.close()
        except Exception:
            pass
        progress.finish()

    return {
        "index": index,
        "named": named,
        "inline": inline,
        "messages": messages,
        "seconds": round(time.time() - started, 1),
        "pst": str(pst_path),
    }


def rewrite_catalog(out_dir: Path, rows: list[dict[str, Any]]) -> None:
    dest = out_dir / "attachments.jsonl"
    tmp = dest.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(dest)


def rewrite_messages(
    out_dir: Path,
    by_hash: dict[str, dict[str, Any]],
    pst_index: dict[tuple[str, int], dict[str, Any]] | None,
) -> dict[str, Any]:
    src = out_dir / "messages.jsonl"
    tmp = src.with_suffix(".jsonl.tmp")
    updated = 0
    named = 0
    started = time.time()
    with src.open(encoding="utf-8") as reader, tmp.open("w", encoding="utf-8") as writer:
        for line in reader:
            if not line.strip():
                continue
            row = json.loads(line)
            ident = str(row.get("pst_identifier") or "")
            changed = False
            for i, att in enumerate(row.get("attachments") or []):
                digest = att.get("sha256")
                hashed = by_hash.get(digest or "")
                outlook = (pst_index or {}).get((ident, i))
                sniff = None
                if hashed and hashed.get("ext"):
                    sniff = Sniff(
                        hashed.get("ext") or "",
                        hashed.get("sniff_mime") or "",
                        hashed.get("kind") or "unknown",
                    )
                if hashed:
                    if att.get("path") != hashed.get("path"):
                        att["path"] = hashed["path"]
                        changed = True
                    att["kind"] = hashed.get("kind")
                    att["ext"] = hashed.get("ext")
                    att["content_type"] = (
                        (outlook or {}).get("mime")
                        or hashed.get("sniff_mime")
                        or att.get("content_type")
                    )
                if outlook:
                    recovered = display_name(
                        OutlookAttach(
                            name=outlook.get("name"),
                            short_name=outlook.get("short_name"),
                            mime=outlook.get("mime"),
                            content_id=outlook.get("content_id"),
                        ),
                        i,
                        sniff,
                    )
                    if recovered and recovered != att.get("name"):
                        att["name"] = recovered
                        named += 1
                        changed = True
                    att["content_id"] = outlook.get("content_id")
                    att["inline"] = bool(outlook.get("inline"))
                elif hashed and (
                    not att.get("name") or str(att.get("name")).startswith("attachment-")
                ):
                    ext = hashed.get("ext") or ""
                    att["name"] = f"attachment-{i + 1}{ext}"
                    att["kind"] = hashed.get("kind")
                    att["inline"] = is_likely_inline(
                        att["name"], hashed.get("sniff_mime"), None
                    )
                    changed = True
            if changed:
                updated += 1
            writer.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(src)
    return {
        "messages_updated": updated,
        "names_applied": named,
        "seconds": round(time.time() - started, 1),
    }


def repair_mailbox(out_dir: Path, *, apply: bool, from_pst: bool) -> dict[str, Any]:
    print(f"\n== {out_dir.name} ==")
    sniff = sniff_mailbox(out_dir, apply=apply)
    print(
        f"  sniff {human_duration(sniff['seconds'])}  files {human_int(len(sniff['rows']))}  "
        f"renamed {human_int(sniff['renamed'])}  missing {human_int(sniff['missing'])}"
    )
    print("  types: " + ", ".join(f"{k} {v}" for k, v in sniff["kinds"].most_common()))
    pst_info: dict[str, Any] | None = None
    pst_index = None
    if from_pst and apply:
        print("  recovering Outlook filenames from PST…")
        pst_info = recover_names_from_pst(out_dir, sniff["by_hash"])
        pst_index = pst_info["index"]
        print(
            f"  MAPI pass {human_duration(pst_info['seconds'])}  "
            f"named entries {human_int(pst_info['named'])}  inline {human_int(pst_info['inline'])}"
        )
    msg_info = None
    if apply:
        rewrite_catalog(out_dir, sniff["rows"])
        msg_info = rewrite_messages(out_dir, sniff["by_hash"], pst_index)
        print(
            f"  messages rewritten {human_int(msg_info['messages_updated'])}  "
            f"names applied {human_int(msg_info['names_applied'])}"
        )
    summary = {
        "mailbox": out_dir.name,
        "kinds": dict(sniff["kinds"]),
        "renamed": sniff["renamed"],
        "missing": sniff["missing"],
        "pst": {
            "named": (pst_info or {}).get("named"),
            "inline": (pst_info or {}).get("inline"),
            "seconds": (pst_info or {}).get("seconds"),
        }
        if pst_info
        else None,
        "messages": msg_info,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    if apply:
        (out_dir / "attachments-repair.json").write_text(
            json.dumps(summary, indent=2) + "\n", encoding="utf-8"
        )
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair PST attachment names/types locally")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--mailbox", help="Repair a single extracted mailbox folder name")
    parser.add_argument("--scan-only", action="store_true", help="Sniff types, do not rename or rewrite")
    parser.add_argument("--no-pst", action="store_true", help="Skip Outlook filename recovery")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dirs = mailbox_dirs(args.output, args.mailbox)
    print("Attachment repair")
    print(f"  output  {args.output}")
    print(f"  mailboxes {len(dirs)}")
    print(f"  disk    {shutil.disk_usage(args.output).free / (1024**3):.1f} GB free")
    apply = not args.scan_only
    from_pst = apply and not args.no_pst
    summaries = [repair_mailbox(d, apply=apply, from_pst=from_pst) for d in dirs]
    if apply:
        (args.output / "attachments-repair-summary.json").write_text(
            json.dumps({"results": summaries}, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        if sys.stderr.isatty():
            sys.stderr.write(SHOW_CURSOR)
            sys.stderr.flush()
