"""Shared PST attachment helpers: MAPI names + magic-byte sniffing."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# MAPI attach tags (libpff entry_type is the 16-bit property ID)
MAPI_ATTACH_EXTENSION = 0x3703
MAPI_ATTACH_FILENAME = 0x3704
MAPI_ATTACH_LONG_FILENAME = 0x3707
MAPI_ATTACH_MIME_TAG = 0x370E
MAPI_ATTACH_CONTENT_ID = 0x3712
MAPI_ATTACH_CONTENT_LOCATION = 0x3713

INLINE_NAME = re.compile(r"^(image|img|oledata|logo|signature)\d*\.(png|gif|jpe?g|bmp|wmz)$", re.I)


@dataclass(frozen=True)
class Sniff:
    ext: str
    mime: str
    kind: str


@dataclass
class OutlookAttach:
    name: str | None = None
    short_name: str | None = None
    mime: str | None = None
    content_id: str | None = None
    extension: str | None = None


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


def sniff_bytes(data: bytes) -> Sniff:
    head = data[:16]
    extra = data[:16384]
    if head.startswith(b"%PDF"):
        return Sniff(".pdf", "application/pdf", "pdf")
    if head.startswith(b"PK"):
        blob = extra
        if b"word/" in blob or b"wordprocessingml" in blob:
            return Sniff(
                ".docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            )
        if b"xl/" in blob or b"spreadsheetml" in blob:
            return Sniff(
                ".xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xlsx",
            )
        if b"ppt/" in blob or b"presentationml" in blob:
            return Sniff(
                ".pptx",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "pptx",
            )
        return Sniff(".zip", "application/zip", "zip")
    if head[:3] == b"\xff\xd8\xff":
        return Sniff(".jpg", "image/jpeg", "jpeg")
    if head.startswith(b"\x89PNG"):
        return Sniff(".png", "image/png", "png")
    if head.startswith(b"GIF8"):
        return Sniff(".gif", "image/gif", "gif")
    if head.startswith(b"II*\x00") or head.startswith(b"MM\x00*"):
        return Sniff(".tif", "image/tiff", "tiff")
    if head.startswith(b"{\\rtf"):
        return Sniff(".rtf", "application/rtf", "rtf")
    if head[:4] == b"\x78\x9f\x3e\x22":
        return Sniff(".dat", "application/vnd.ms-tnef", "tnef")
    if head.startswith(b"Rar!"):
        return Sniff(".rar", "application/vnd.rar", "rar")
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return _ole_sniff(extra)
    sample = extra[:400].lstrip().lower()
    if sample.startswith(b"<!doctype html") or sample.startswith(b"<html") or b"<html" in sample:
        return Sniff(".html", "text/html", "html")
    if extra.startswith(b"{\x5c") or extra[:1] in (b"{", b"["):
        return Sniff(".json", "application/json", "json")
    return Sniff("", "application/octet-stream", "unknown")


def _ole_sniff(data: bytes) -> Sniff:
    if b"WordDocument" in data:
        return Sniff(".doc", "application/msword", "doc")
    if b"Workbook" in data or b"Book\x00" in data:
        return Sniff(".xls", "application/vnd.ms-excel", "xls")
    if b"PowerPoint Document" in data:
        return Sniff(".ppt", "application/vnd.ms-powerpoint", "ppt")
    if b"__substg1.0_" in data:
        return Sniff(".msg", "application/vnd.ms-outlook", "msg")
    return Sniff(".ole", "application/x-ole-storage", "ole")


def sniff_file(path: Path) -> Sniff:
    with path.open("rb") as handle:
        data = handle.read(16384)
    return sniff_bytes(data)


def safe_filename(name: str | None, fallback: str) -> str:
    raw = Path(name or "").name.strip() or fallback
    raw = raw.replace("\\", "_").replace("/", "_")
    raw = re.sub(r"[\x00-\x1f]", "", raw)
    raw = re.sub(r"[<>:\"|?*]", "_", raw)
    return raw[:180] or fallback


def safe_ext(name: str | None) -> str:
    ext = Path(name or "").suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
        return ext
    return ""


def is_likely_inline(name: str | None, mime: str | None, content_id: str | None) -> bool:
    n = (name or "").lower()
    if content_id and INLINE_NAME.match(n):
        return True
    if INLINE_NAME.match(n):
        return True
    mime = (mime or "").lower()
    if mime.startswith("image/") and (n.startswith("image") or n.startswith("img")):
        return True
    return False


# PT_STRING8 / PT_UNICODE — the only MAPI types safe to read as UTF-8.
_STRING_VALUE_TYPES = {0x001E, 0x001F, 30, 31}


def _entry_attr(entry: Any, *names: str) -> Any:
    for name in names:
        try:
            value = getattr(entry, name, None)
        except Exception:
            continue
        if callable(value):
            try:
                return value()
            except Exception:
                continue
        if value is not None:
            return value
    return None


def _entry_string(entry: Any) -> str | None:
    value_type = _entry_attr(entry, "value_type", "get_value_type")
    try:
        if value_type is not None and int(value_type) not in _STRING_VALUE_TYPES:
            return None
    except (TypeError, ValueError):
        pass
    try:
        raw = _entry_attr(entry, "get_data_as_string", "data_as_string")
    except Exception:
        return None
    return as_str(raw)


def outlook_attachment_meta(att: Any) -> OutlookAttach:
    meta = OutlookAttach()
    nrs = getattr(att, "get_number_of_record_sets", None)
    try:
        sets = nrs() if callable(nrs) else getattr(att, "number_of_record_sets", 0)
    except Exception:
        sets = 0
    for i in range(int(sets or 0)):
        try:
            record_set = att.get_record_set(i)
        except Exception:
            continue
        nent = getattr(record_set, "get_number_of_entries", None)
        try:
            entries = nent() if callable(nent) else getattr(record_set, "number_of_entries", 0)
        except Exception:
            continue
        getter = getattr(record_set, "get_entry", None)
        if not callable(getter):
            continue
        for j in range(int(entries or 0)):
            try:
                entry = getter(j)
                entry_type = int(_entry_attr(entry, "entry_type", "get_entry_type") or 0)
                text = _entry_string(entry)
            except Exception:
                continue
            if not text:
                continue
            if entry_type == MAPI_ATTACH_LONG_FILENAME:
                meta.name = text
            elif entry_type == MAPI_ATTACH_FILENAME:
                meta.short_name = text
            elif entry_type == MAPI_ATTACH_MIME_TAG:
                meta.mime = text
            elif entry_type == MAPI_ATTACH_CONTENT_ID:
                meta.content_id = text
            elif entry_type == MAPI_ATTACH_EXTENSION:
                meta.extension = text if text.startswith(".") else f".{text}"
    if not meta.name:
        meta.name = meta.short_name
    return meta


def display_name(meta: OutlookAttach, index: int, sniff: Sniff | None = None) -> str:
    fallback = f"attachment-{index + 1}{(sniff.ext if sniff else '')}"
    name = safe_filename(meta.name or meta.short_name, fallback)
    if sniff and sniff.ext and not Path(name).suffix:
        name = f"{name}{sniff.ext}"
    return name


def find_hashed_file(attachments_dir: Path, digest: str) -> Path | None:
    folder = attachments_dir / digest[:2] / digest[2:4]
    exact = folder / digest
    if exact.exists() and exact.is_file():
        return exact
    if folder.exists():
        matches = sorted(folder.glob(digest + ".*"))
        if matches:
            return matches[0]
    return None
