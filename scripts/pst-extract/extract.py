#!/usr/bin/env python3
"""Extract Outlook PST mailboxes into JSONL + deduped attachments.

Designed for local 10–20GB PSTs. Does not send mail to agents.

Usage:
  python extract.py --scan-only
  python extract.py
  python extract.py --file "docs/pst_files/OUTLOOK SEP 2025-2026 RAKESH.pst"
  python extract.py --skip-attachments
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import sys
import time
from datetime import datetime, timezone
from email.parser import HeaderParser
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

try:
    import pypff
except ImportError:
    sys.stderr.write(
        "pypff is not installed. From the repo root run:\n"
        "  python3 -m venv scripts/pst-extract/.venv\n"
        "  scripts/pst-extract/.venv/bin/pip install -r scripts/pst-extract/requirements.txt\n"
    )
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "docs" / "pst_files"
DEFAULT_OUTPUT = ROOT / "data" / "pst_extract"
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from pstutil import (  # noqa: E402
    display_name,
    is_likely_inline,
    outlook_attachment_meta,
    sniff_bytes,
)

HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
CLEAR_LINE = "\033[2K"
MOVE_UP = "\033[F"
BAR_WIDTH = 32
BODY_TEXT_LIMIT = 1_000_000
BODY_HTML_LIMIT = 512_000
PROGRESS_EVERY = 20
MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
STOP = False

SKIP_FOLDER_HINTS = (
    "junk email",
    "junk e-mail",
    "spam",
    "sync issues",
    "conflicts",
    "local failures",
    "server failures",
    "rss feeds",
    "conversation history",
)


def handle_stop(signum: int, _frame: Any) -> None:
    global STOP
    STOP = True
    print(f"\nReceived signal {signum}; finishing current message and writing checkpoint…")


signal.signal(signal.SIGINT, handle_stop)
signal.signal(signal.SIGTERM, handle_stop)


def call(obj: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        if obj is None:
            return default
        try:
            attr = getattr(obj, name, None)
        except Exception:
            continue
        if callable(attr):
            try:
                return attr()
            except Exception:
                continue
        if attr is not None:
            return attr
    return default


def as_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value
    elif isinstance(value, memoryview):
        return as_str(value.tobytes())
    elif isinstance(value, (bytes, bytearray)):
        for enc in ("utf-8", "utf-16le", "utf-16be", "cp1252", "latin-1"):
            try:
                text = value.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = value.decode("utf-8", errors="replace")
    else:
        text = str(value)
    text = text.replace("\x00", "").strip()
    return text or None


def as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def as_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    text = as_str(value)
    if not text:
        return None
    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        return text


def slugify(name: str) -> str:
    stem = Path(name).stem.replace("@", "_at_")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", stem).strip("_").lower()
    return (slug[:80] or "mailbox").rstrip("_")


def human_bytes(n: float) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(max(0, n))
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{n:.0f} B"


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


def disk_free(path: Path) -> int:
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free


def render_bar(done: int, total: int, width: int = BAR_WIDTH) -> str:
    if total <= 0:
        return "░" * width
    frac = min(1.0, max(0.0, done / total))
    filled = int(round(width * frac))
    if filled > width:
        filled = width
    return "█" * filled + "░" * (width - filled)


def parse_headers(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        header = HeaderParser().parsestr(raw, headersonly=True)
    except Exception:
        return {}
    addresses = {
        "from": getaddresses(header.get_all("from", [])),
        "to": getaddresses(header.get_all("to", [])),
        "cc": getaddresses(header.get_all("cc", [])),
        "bcc": getaddresses(header.get_all("bcc", [])),
    }
    return {
        "message_id": (header.get("message-id") or "").strip() or None,
        "in_reply_to": (header.get("in-reply-to") or "").strip() or None,
        "references": (header.get("references") or "").strip() or None,
        "thread_topic": (header.get("thread-topic") or header.get("thread-index") or "").strip()
        or None,
        "date_header": (header.get("date") or "").strip() or None,
        "from": [{"name": n, "email": e} for n, e in addresses["from"] if e],
        "to": [{"name": n, "email": e} for n, e in addresses["to"] if e],
        "cc": [{"name": n, "email": e} for n, e in addresses["cc"] if e],
        "bcc": [{"name": n, "email": e} for n, e in addresses["bcc"] if e],
        "content_type": (header.get("content-type") or "").strip() or None,
    }


def first_email(entries: list[dict[str, str]]) -> str | None:
    for entry in entries:
        email = (entry.get("email") or "").strip()
        if email:
            return email
    return None


def folder_name(folder: Any) -> str:
    return as_str(call(folder, "get_name", "name", "get_display_name")) or "(unnamed)"


def should_skip_folder(path: str, include_junk: bool) -> bool:
    if include_junk:
        return False
    lower = path.lower()
    return any(hint in lower for hint in SKIP_FOLDER_HINTS)


def iter_sub_folders(folder: Any) -> Iterable[Any]:
    count = as_int(call(folder, "get_number_of_sub_folders", "number_of_sub_folders"))
    getter = getattr(folder, "get_sub_folder", None)
    if callable(getter):
        for i in range(count):
            try:
                child = getter(i)
            except Exception:
                continue
            if child is not None:
                yield child
        return
    children = call(folder, "sub_folders", default=[]) or []
    for child in children:
        yield child


def iter_sub_messages(folder: Any) -> Iterable[Any]:
    count = as_int(call(folder, "get_number_of_sub_messages", "number_of_sub_messages"))
    getter = getattr(folder, "get_sub_message", None)
    if callable(getter):
        for i in range(count):
            try:
                msg = getter(i)
            except Exception:
                continue
            if msg is not None:
                yield msg
        return
    messages = call(folder, "sub_messages", default=[]) or []
    for msg in messages:
        yield msg


def message_count(folder: Any) -> int:
    return as_int(call(folder, "get_number_of_sub_messages", "number_of_sub_messages"))


def walk_folders(root: Any) -> list[tuple[str, Any, int]]:
    found: list[tuple[str, Any, int]] = []

    def visit(folder: Any, path: str) -> None:
        name = folder_name(folder)
        unnamed_root = not path and name == "(unnamed)"
        folder_path = path if unnamed_root else (f"{path}/{name}" if path else name)
        count = message_count(folder)
        if folder_path or count:
            found.append((folder_path or "(root)", folder, count))
        for child in iter_sub_folders(folder):
            visit(child, folder_path)

    visit(root, "")
    return found


def clip(text: str | None, limit: int) -> tuple[str | None, int, bool]:
    if not text:
        return None, 0, False
    size = len(text)
    if size <= limit:
        return text, size, False
    return text[:limit], size, True


def read_attachment_bytes(att: Any) -> bytes:
    size = as_int(call(att, "get_size", "get_data_size", "size"))
    if hasattr(att, "read_buffer"):
        try:
            data = att.read_buffer(size) if size else att.read_buffer()
        except TypeError:
            data = att.read_buffer()
        if isinstance(data, memoryview):
            return data.tobytes()
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        if data is not None:
            return bytes(data)
    data = call(att, "get_data", "data")
    if isinstance(data, memoryview):
        return data.tobytes()
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    return b""


def attachment_name(att: Any, index: int) -> str:
    meta = outlook_attachment_meta(att)
    return display_name(meta, index)


def safe_ext(name: str) -> str:
    ext = Path(name).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
        return ext
    return ""


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.skip = True
        elif tag in {"p", "br", "div", "tr", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.skip = False

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _HTMLText()
    try:
        parser.feed(html)
        text = "".join(parser.parts)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


class Progress:
    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled and sys.stderr.isatty()
        self.lines = 3
        self.printed = False

    def start(self) -> None:
        if self.enabled:
            sys.stderr.write(HIDE_CURSOR)

    def render(self, lines: list[str]) -> None:
        padded = (lines + [""] * self.lines)[: self.lines]
        if not self.enabled:
            sys.stderr.write(padded[0] + "\n")
            return
        if self.printed:
            sys.stderr.write(MOVE_UP * self.lines)
        for line in padded:
            sys.stderr.write(f"{CLEAR_LINE}\r{line}\n")
        sys.stderr.flush()
        self.printed = True

    def finish(self) -> None:
        if self.enabled:
            sys.stderr.write(SHOW_CURSOR)
            sys.stderr.flush()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_done_ids(path: Path) -> set[str]:
    done: set[str] = set()
    if not path.exists():
        return done
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            ident = row.get("id")
            if ident:
                done.add(str(ident))
    return done


def load_attachment_hashes(path: Path) -> set[str]:
    hashes: set[str] = set()
    if not path.exists():
        return hashes
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            digest = row.get("sha256")
            if digest:
                hashes.add(str(digest))
    return hashes


def estimate_range(message_total: int, with_attachments: bool) -> tuple[int, int]:
    if message_total <= 0:
        return 0, 0
    # Conservative local rates observed with libpff: metadata is fast; attachments dominate.
    slow = 12 if with_attachments else 40
    fast = 35 if with_attachments else 120
    return max(1, message_total // fast), max(1, message_total // slow)


def scan_pst(pst_path: Path, include_junk: bool) -> dict[str, Any]:
    archive = pypff.file()
    archive.open(str(pst_path))
    try:
        root = archive.get_root_folder()
        folders = walk_folders(root)
        folder_rows = []
        total = 0
        skipped = 0
        for path, _folder, count in folders:
            skip = should_skip_folder(path, include_junk)
            folder_rows.append({"path": path, "messages": count, "skipped": skip})
            if skip:
                skipped += count
            else:
                total += count
        orphans = as_int(call(archive, "get_number_of_orphan_items", "number_of_orphan_items"))
        return {
            "file": str(pst_path),
            "size_bytes": pst_path.stat().st_size,
            "folders": len(folders),
            "messages": total,
            "skipped_messages": skipped,
            "orphan_items": orphans,
            "folder_rows": folder_rows,
        }
    finally:
        archive.close()


def extract_message(
    msg: Any,
    *,
    mailbox: str,
    folder_path: str,
    attachments_dir: Path,
    attachments_jsonl: Any,
    seen_hashes: set[str],
    skip_attachments: bool,
    max_attachment_bytes: int | None,
) -> dict[str, Any]:
    ident = as_str(call(msg, "get_identifier", "identifier")) or hashlib.sha1(
        f"{folder_path}:{call(msg, 'get_subject', 'subject')}".encode("utf-8", errors="replace")
    ).hexdigest()
    headers_raw = as_str(call(msg, "get_transport_headers", "transport_headers"))
    parsed = parse_headers(headers_raw)
    sender_name = as_str(call(msg, "get_sender_name", "sender_name"))
    sender_email = as_str(
        call(msg, "get_sender_email_address", "sender_email_address")
    ) or first_email(parsed.get("from") or [])
    submitted = as_iso(call(msg, "get_client_submit_time", "client_submit_time"))
    delivered = as_iso(call(msg, "get_delivery_time", "delivery_time"))
    date_header = as_iso(parsed.get("date_header"))
    body_text, text_len, text_clipped = clip(
        as_str(call(msg, "get_plain_text_body", "plain_text_body")), BODY_TEXT_LIMIT
    )
    body_html, html_len, html_clipped = clip(
        as_str(call(msg, "get_html_body", "html_body")), BODY_HTML_LIMIT
    )
    if not body_text and body_html:
        body_text, text_len, text_clipped = clip(html_to_text(body_html), BODY_TEXT_LIMIT)

    attachment_meta: list[dict[str, Any]] = []
    att_count = as_int(call(msg, "get_number_of_attachments", "number_of_attachments"))
    if not skip_attachments:
        getter = getattr(msg, "get_attachment", None)
        for i in range(att_count):
            try:
                att = getter(i) if callable(getter) else None
                if att is None:
                    continue
                outlook = outlook_attachment_meta(att)
                size = as_int(call(att, "get_size", "get_data_size", "size"))
                if max_attachment_bytes and size > max_attachment_bytes:
                    attachment_meta.append(
                        {
                            "name": display_name(outlook, i),
                            "size": size,
                            "skipped": True,
                            "reason": "over_size_limit",
                        }
                    )
                    continue
                data = read_attachment_bytes(att)
                digest = hashlib.sha256(data).hexdigest()
                sniffed = sniff_bytes(data)
                name = display_name(outlook, i, sniffed)
                ext = sniffed.ext or safe_ext(name)
                rel = f"{digest[:2]}/{digest[2:4]}/{digest}{ext}"
                dest = attachments_dir / rel
                if digest not in seen_hashes:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(data)
                    seen_hashes.add(digest)
                    attachments_jsonl.write(
                        json.dumps(
                            {
                                "sha256": digest,
                                "path": rel,
                                "bytes": len(data),
                                "name": name,
                                "kind": sniffed.kind,
                                "ext": ext,
                                "content_type": outlook.mime or sniffed.mime,
                                "mailbox": mailbox,
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                attachment_meta.append(
                    {
                        "name": name,
                        "size": len(data) or size,
                        "sha256": digest,
                        "path": rel,
                        "kind": sniffed.kind,
                        "ext": ext,
                        "content_type": outlook.mime or sniffed.mime,
                        "content_id": outlook.content_id,
                        "inline": is_likely_inline(name, outlook.mime or sniffed.mime, outlook.content_id),
                    }
                )
            except Exception as exc:
                attachment_meta.append(
                    {"index": i, "error": f"{type(exc).__name__}: {exc}"}
                )

    return {
        "id": f"{mailbox}:{ident}",
        "pst_identifier": ident,
        "mailbox": mailbox,
        "folder": folder_path,
        "subject": as_str(call(msg, "get_subject", "subject")),
        "sender_name": sender_name,
        "sender_email": sender_email,
        "display_to": as_str(call(msg, "get_display_to", "display_to")),
        "display_cc": as_str(call(msg, "get_display_cc", "display_cc")),
        "display_bcc": as_str(call(msg, "get_display_bcc", "display_bcc")),
        "conversation_topic": as_str(
            call(msg, "get_conversation_topic", "conversation_topic")
        ),
        "submitted_at": submitted,
        "delivered_at": delivered,
        "date": delivered or submitted or date_header,
        "message_id": parsed.get("message_id"),
        "in_reply_to": parsed.get("in_reply_to"),
        "references": parsed.get("references"),
        "from": parsed.get("from") or ([{"name": sender_name, "email": sender_email}] if sender_email else []),
        "to": parsed.get("to") or [],
        "cc": parsed.get("cc") or [],
        "bcc": parsed.get("bcc") or [],
        "body_text": body_text,
        "body_html": body_html,
        "body_text_chars": text_len,
        "body_html_chars": html_len,
        "body_text_clipped": text_clipped,
        "body_html_clipped": html_clipped,
        "attachment_count": att_count,
        "attachments": attachment_meta,
        "headers_raw": headers_raw,
    }


def extract_pst(
    pst_path: Path,
    out_root: Path,
    *,
    skip_attachments: bool,
    include_junk: bool,
    max_attachment_bytes: int | None,
    limit: int | None,
    resume: bool,
) -> dict[str, Any]:
    mailbox = slugify(pst_path.name)
    out_dir = out_root / mailbox
    attachments_dir = out_dir / "attachments"
    messages_path = out_dir / "messages.jsonl"
    attachments_path = out_dir / "attachments.jsonl"
    errors_path = out_dir / "errors.jsonl"
    progress_path = out_dir / "progress.json"
    status_path = out_dir / "STATUS.txt"
    folders_path = out_dir / "folders.json"
    source_path = out_dir / "source.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nOpening {pst_path.name} ({human_bytes(pst_path.stat().st_size)})…")

    done_ids = load_done_ids(messages_path) if resume else set()
    if not resume and messages_path.exists():
        messages_path.unlink()
        if attachments_path.exists():
            attachments_path.unlink()
        if errors_path.exists():
            errors_path.unlink()
        done_ids = set()

    archive = pypff.file()
    archive.open(str(pst_path))
    progress = Progress(enabled=True)
    progress.start()
    started = time.time()
    processed = 0
    written = 0
    skipped_existing = 0
    errors = 0
    attachment_files = 0
    attachment_bytes = 0
    current_folder = ""
    last_status = 0.0
    messages_handle = None
    attachments_handle = None
    errors_handle = None
    scan: dict[str, Any] = {}
    target_total = 0

    try:
        scan_started = time.time()
        root = archive.get_root_folder()
        folders = walk_folders(root)
        folder_rows = []
        messages = 0
        skipped_messages = 0
        for path, _folder, count in folders:
            skip = should_skip_folder(path, include_junk)
            folder_rows.append({"path": path, "messages": count, "skipped": skip})
            if skip:
                skipped_messages += count
            else:
                messages += count
        scan_seconds = time.time() - scan_started
        scan = {
            "messages": messages,
            "skipped_messages": skipped_messages,
            "folders": len(folders),
            "orphan_items": as_int(
                call(archive, "get_number_of_orphan_items", "number_of_orphan_items")
            ),
        }
        write_json(folders_path, folder_rows)
        write_json(
            source_path,
            {
                "path": str(pst_path),
                "name": pst_path.name,
                "mailbox": mailbox,
                "size_bytes": pst_path.stat().st_size,
                "scanned_at": datetime.now(timezone.utc).isoformat(),
                "scan_seconds": round(scan_seconds, 2),
                **scan,
            },
        )
        remaining = max(0, messages - len(done_ids))
        if limit is not None:
            remaining = min(remaining, limit)
        slow, fast = estimate_range(remaining, not skip_attachments)
        target_total = messages if limit is None else min(messages, len(done_ids) + limit)
        print(
            f"  folders {human_int(scan['folders'])}  messages {human_int(messages)}  "
            f"already extracted {human_int(len(done_ids))}  remaining ~{human_int(remaining)}"
        )
        print(
            f"  scan {human_duration(scan_seconds)}  estimated extract {human_duration(slow)} – {human_duration(fast)}"
            f"{'' if skip_attachments else ' (with attachments)'}"
        )
        free = disk_free(out_dir)
        print(f"  disk free {human_bytes(free)}")
        if free < MIN_FREE_BYTES:
            raise SystemExit(f"Need at least {human_bytes(MIN_FREE_BYTES)} free; aborting.")

        messages_handle = messages_path.open("a", encoding="utf-8")
        attachments_handle = attachments_path.open("a", encoding="utf-8")
        errors_handle = errors_path.open("a", encoding="utf-8")
        seen_hashes = load_attachment_hashes(attachments_path)
        started = time.time()

        def persist_progress(status: str) -> None:
            elapsed = time.time() - started
            rate = processed / elapsed if elapsed > 0 else 0
            eta = (target_total - processed) / rate if rate > 0 else None
            payload = {
                "status": status,
                "mailbox": mailbox,
                "file": pst_path.name,
                "folder": current_folder,
                "processed": processed,
                "written": written,
                "skipped_existing": skipped_existing,
                "errors": errors,
                "target": target_total,
                "messages_in_pst": scan["messages"],
                "percent": round((processed / target_total) * 100, 2) if target_total else 100,
                "rate_per_sec": round(rate, 2),
                "elapsed_seconds": round(elapsed, 1),
                "eta_seconds": None if eta is None else round(eta, 1),
                "eta_human": human_duration(eta),
                "attachment_files": attachment_files,
                "attachment_bytes": attachment_bytes,
                "disk_free_bytes": disk_free(out_dir),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            write_json(progress_path, payload)
            status_path.write_text(
                "\n".join(
                    [
                        f"{pst_path.name}",
                        f"status     {status}",
                        f"progress   {payload['percent']}%  {human_int(processed)}/{human_int(target_total)}",
                        f"written    {human_int(written)}  skipped {human_int(skipped_existing)}  errors {human_int(errors)}",
                        f"rate       {payload['rate_per_sec']} msg/s",
                        f"elapsed    {human_duration(elapsed)}",
                        f"eta        {human_duration(eta)}",
                        f"folder     {current_folder or '-'}",
                        f"attach     {human_int(attachment_files)} files / {human_bytes(attachment_bytes)}",
                        f"disk free  {human_bytes(payload['disk_free_bytes'])}",
                        f"updated    {payload['updated_at']}",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            pct = payload["percent"]
            bar = render_bar(processed, target_total)
            progress.render(
                [
                    f"{bar}  {pct:5.1f}%  {human_int(processed)}/{human_int(target_total)} msgs  {payload['rate_per_sec']:.1f}/s  elapsed {human_duration(elapsed)}  ETA {human_duration(eta)}",
                    f"{mailbox}  {current_folder or 'starting…'}",
                    f"written {human_int(written)}  attachments {human_int(attachment_files)} ({human_bytes(attachment_bytes)})  errors {human_int(errors)}  disk {human_bytes(payload['disk_free_bytes'])} free",
                ]
            )

        persist_progress("extracting")

        for folder_path, folder, _count in folders:
            if STOP or (limit is not None and written >= limit):
                break
            if should_skip_folder(folder_path, include_junk):
                continue
            current_folder = folder_path
            for msg in iter_sub_messages(folder):
                if STOP or (limit is not None and written >= limit):
                    break
                ident = as_str(call(msg, "get_identifier", "identifier"))
                row_id = f"{mailbox}:{ident}" if ident else None
                if row_id and row_id in done_ids:
                    skipped_existing += 1
                    processed += 1
                    continue
                try:
                    row = extract_message(
                        msg,
                        mailbox=mailbox,
                        folder_path=folder_path,
                        attachments_dir=attachments_dir,
                        attachments_jsonl=attachments_handle,
                        seen_hashes=seen_hashes,
                        skip_attachments=skip_attachments,
                        max_attachment_bytes=max_attachment_bytes,
                    )
                    messages_handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                    done_ids.add(row["id"])
                    written += 1
                    for att in row.get("attachments") or []:
                        if att.get("path") and not att.get("skipped"):
                            attachment_files += 1
                            attachment_bytes += as_int(att.get("size"))
                except Exception as exc:
                    errors += 1
                    errors_handle.write(
                        json.dumps(
                            {
                                "folder": folder_path,
                                "id": row_id,
                                "error": f"{type(exc).__name__}: {exc}",
                                "at": datetime.now(timezone.utc).isoformat(),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                processed += 1
                now = time.time()
                if processed % PROGRESS_EVERY == 0 or now - last_status > 2:
                    messages_handle.flush()
                    attachments_handle.flush()
                    errors_handle.flush()
                    persist_progress("extracting")
                    last_status = now
                    if disk_free(out_dir) < MIN_FREE_BYTES:
                        raise SystemExit(
                            f"Disk dropped below {human_bytes(MIN_FREE_BYTES)}; checkpoint saved. Free space and re-run (resume is default)."
                        )

        persist_progress("stopped" if STOP else "completed")
        elapsed = time.time() - started
        result = {
            "mailbox": mailbox,
            "file": pst_path.name,
            "status": "stopped" if STOP else "completed",
            "processed": processed,
            "written": written,
            "skipped_existing": skipped_existing,
            "errors": errors,
            "elapsed_seconds": round(elapsed, 1),
            "rate_per_sec": round(processed / elapsed, 2) if elapsed else 0,
            "output": str(out_dir),
        }
        write_json(out_dir / "summary.json", result)
        return result
    finally:
        progress.finish()
        try:
            archive.close()
        except Exception:
            pass
        for handle in (messages_handle, attachments_handle, errors_handle):
            if handle:
                handle.close()


def discover_pst_files(input_dir: Path, only: Path | None) -> list[Path]:
    if only:
        path = only if only.is_absolute() else (ROOT / only)
        if not path.exists():
            raise SystemExit(f"PST not found: {path}")
        return [path]
    if not input_dir.exists():
        raise SystemExit(f"Input directory not found: {input_dir}")
    files = sorted(
        [p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".pst"],
        key=lambda p: p.stat().st_size,
    )
    if not files:
        raise SystemExit(f"No .pst files in {input_dir}")
    return files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract local Outlook PST files")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Directory of PST files")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Extract output root")
    parser.add_argument("--file", type=Path, help="Extract a single PST instead of the whole folder")
    parser.add_argument("--scan-only", action="store_true", help="Count folders/messages and estimate time")
    parser.add_argument("--skip-attachments", action="store_true", help="Write message JSONL only")
    parser.add_argument("--include-junk", action="store_true", help="Also extract junk/sync folders")
    parser.add_argument(
        "--max-attachment-mb",
        type=float,
        default=25,
        help="Skip attachments larger than this (0 = no limit)",
    )
    parser.add_argument("--limit", type=int, help="Stop after N messages (per PST), useful for smoke tests")
    parser.add_argument("--no-resume", action="store_true", help="Delete existing extract and start over")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    files = discover_pst_files(args.input, args.file)
    max_bytes = None if args.max_attachment_mb <= 0 else int(args.max_attachment_mb * 1024 * 1024)

    print("PST extract")
    print(f"  input   {args.input if not args.file else args.file}")
    print(f"  output  {args.output}")
    print(f"  files   {len(files)}")
    print(f"  disk    {human_bytes(disk_free(args.output))} free")

    scans = []
    for pst in files:
        print(f"\n== {pst.name} ({human_bytes(pst.stat().st_size)}) ==")
        started = time.time()
        scan = scan_pst(pst, args.include_junk)
        scan["scan_seconds"] = round(time.time() - started, 2)
        scans.append(scan)
        slow, fast = estimate_range(scan["messages"], not args.skip_attachments)
        print(
            f"  {human_int(scan['folders'])} folders  {human_int(scan['messages'])} messages  "
            f"{human_int(scan['skipped_messages'])} skipped  {human_int(scan['orphan_items'])} orphans"
        )
        print(
            f"  scan {human_duration(scan['scan_seconds'])}  estimated extract {human_duration(slow)} – {human_duration(fast)}"
        )
        top = sorted(scan["folder_rows"], key=lambda r: r["messages"], reverse=True)[:8]
        for row in top:
            flag = " (skip)" if row["skipped"] else ""
            print(f"    {human_int(row['messages']):>8}  {row['path']}{flag}")

    if args.scan_only:
        total_msgs = sum(s["messages"] for s in scans)
        slow, fast = estimate_range(total_msgs, not args.skip_attachments)
        print(
            f"\nAll files: {human_int(total_msgs)} messages  estimated {human_duration(slow)} – {human_duration(fast)}"
        )
        return 0

    results = []
    for pst in files:
        if STOP:
            break
        results.append(
            extract_pst(
                pst,
                args.output,
                skip_attachments=args.skip_attachments,
                include_junk=args.include_junk,
                max_attachment_bytes=max_bytes,
                limit=args.limit,
                resume=not args.no_resume,
            )
        )
        print()
        last = results[-1]
        print(
            f"Done {last['file']}: {last['status']}  wrote {human_int(last['written'])}  "
            f"errors {human_int(last['errors'])}  {human_duration(last['elapsed_seconds'])}  "
            f"{last['rate_per_sec']} msg/s"
        )
        print(f"  output {last['output']}")

    write_json(
        args.output / "run-summary.json",
        {
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "results": results,
        },
    )
    return 1 if STOP else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        if sys.stderr.isatty():
            sys.stderr.write(SHOW_CURSOR)
            sys.stderr.flush()
