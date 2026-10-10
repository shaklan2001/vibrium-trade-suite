#!/usr/bin/env python3
"""Build full-year relevant deal packs from clustered PST extract.

Keeps trade-relevant threads across the mailbox span (~1 year).
Merges Kalpana + Rakesh threads that share a PO. Writes ordered mail chains.
Local, no LLM.

Usage:
  python build_relevant_deals.py
"""

from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from cluster_threads import (  # noqa: E402
    COMMISSION_RE,
    FREIGHT_RE,
    PO_RE,
    TRAVEL_ADMIN_RE,
    TRADER_MARKERS,
    party_role,
    useful_attachments,
)

OUTPUT = ROOT / "data" / "pst_extract"
RELEVANT_DIR = OUTPUT / "relevant"

TRADE_STAGES = {
    "requirement",
    "quoting",
    "pi_po",
    "booking",
    "samples",
    "artwork",
    "inspection",
    "payment",
    "commission",
}

STAGE_RANK = {
    "requirement": 1,
    "quoting": 2,
    "pi_po": 3,
    "artwork": 4,
    "samples": 5,
    "inspection": 6,
    "booking": 7,
    "payment": 8,
    "commission": 9,
    "other": 10,
}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def po_from_thread(thread: dict[str, Any]) -> str | None:
    ident = thread.get("id") or ""
    if ident.startswith("po:"):
        return ident.split(":", 1)[1]
    blob = f"{thread.get('subject') or ''} {ident}"
    match = PO_RE.search(blob)
    if match:
        return match.group(1).replace(" ", "").upper().strip("-/")
    return None


def is_relevant(thread: dict[str, Any]) -> bool:
    """Strict relevance — reject travel/admin and lonely buyer chit-chat."""
    if not thread.get("agent_worthy"):
        return False
    subject = thread.get("subject") or ""
    blob = " ".join(
        [
            subject,
            " ".join(thread.get("subjects") or []),
            " ".join(
                (a.get("name") or "")
                for a in (thread.get("attachments") or thread.get("documents") or [])
            ),
        ]
    )
    if TRAVEL_ADMIN_RE.search(blob) and not po_from_thread(thread):
        return False

    roles = thread.get("roles") or {}
    stage = thread.get("stage") or "other"
    msg_count = int(thread.get("message_count") or 0)
    has_trade_party = bool(
        roles.get("buyer") or roles.get("factory") or roles.get("trader")
    )
    has_forwarder = bool(roles.get("forwarder"))
    has_po = bool(po_from_thread(thread)) or str(thread.get("id") or "").startswith("po:")
    has_docs = int(thread.get("doc_count") or 0) > 0
    freight = stage == "booking" or bool(FREIGHT_RE.search(subject))
    commission = stage == "commission" or bool(COMMISSION_RE.search(subject))

    # Strong signals
    if has_po and (has_trade_party or has_forwarder or has_docs or msg_count >= 2):
        return True
    if commission and (has_trade_party or "snspl" in subject.lower()):
        return True
    if freight and (has_forwarder or has_trader_role(roles) or has_docs):
        return True

    # Multi-message trade conversations
    if stage in TRADE_STAGES and msg_count >= 2 and has_trade_party:
        return True
    if stage in TRADE_STAGES and has_trade_party and has_docs and msg_count >= 1:
        # Single mail + trade doc + known party OK (PI PDF, etc.)
        if stage in {"pi_po", "quoting", "requirement", "artwork", "samples", "inspection"}:
            return True

    # Forwarder freight chains without mapped buyer
    if freight and has_forwarder and msg_count >= 2:
        return True

    return False


def has_trader_role(roles: dict[str, Any]) -> bool:
    return bool(roles.get("trader"))


def deal_id_for(thread: dict[str, Any]) -> str:
    po = po_from_thread(thread)
    if po:
        return f"po:{po}"
    ident = thread.get("id") or ""
    if ident.startswith("bkg:"):
        return ident
    return ident


def fmt_addresses(entries: Any) -> str:
    if not entries:
        return ""
    parts = []
    for item in entries:
        if isinstance(item, dict):
            email = item.get("email") or ""
            name = item.get("name") or ""
            if name and email:
                parts.append(f"{name} <{email}>")
            else:
                parts.append(email or name)
        elif item:
            parts.append(str(item))
    return ", ".join(p for p in parts if p)


def compact_message(row: dict[str, Any]) -> dict[str, Any]:
    docs = useful_attachments(row)
    return {
        "id": row.get("id"),
        "mailbox": row.get("mailbox"),
        "folder": row.get("folder"),
        "date": row.get("date"),
        "from": row.get("sender_email") or fmt_addresses(row.get("from")),
        "from_name": row.get("sender_name"),
        "to": fmt_addresses(row.get("to")) or row.get("display_to"),
        "cc": fmt_addresses(row.get("cc")) or row.get("display_cc"),
        "subject": row.get("subject"),
        "body_text": row.get("body_text") or "",
        "message_id": row.get("message_id"),
        "in_reply_to": row.get("in_reply_to"),
        "role": party_role(row.get("sender_email")),
        "attachments": docs,
    }


def agent_text(messages: list[dict[str, Any]]) -> str:
    blocks = []
    for i, msg in enumerate(messages, 1):
        header = [
            f"[Message {i}/{len(messages)}]",
            f"From: {msg.get('from_name') or ''} <{msg.get('from') or ''}>".strip(),
            f"Role: {msg.get('role') or 'other'}",
            f"Date: {msg.get('date') or ''}",
            f"To: {msg.get('to') or ''}",
        ]
        if msg.get("cc"):
            header.append(f"Cc: {msg['cc']}")
        if msg.get("in_reply_to"):
            header.append(f"In-Reply-To: {msg['in_reply_to']}")
        header.append(f"Subject: {msg.get('subject') or ''}")
        atts = msg.get("attachments") or []
        if atts:
            header.append(
                "Attachments: "
                + ", ".join(a.get("name") or a.get("kind") or "file" for a in atts)
            )
        body = (msg.get("body_text") or "").strip()
        blocks.append("\n".join(header) + "\n\n" + body)
    return "\n\n----------\n\n".join(blocks)


def resolve_commercial_model(
    group: list[dict[str, Any]],
    packed: list[dict[str, Any]],
    parties: dict[str, set[str]],
) -> str:
    for thread in group:
        if thread.get("commercial_model") == "trader_principal":
            return "trader_principal"
    if parties.get("trader"):
        return "trader_principal"
    blob = " ".join(
        (m.get("subject") or "") + " " + (m.get("body_text") or "")[:400] for m in packed[:8]
    ).lower()
    if any(m in blob for m in TRADER_MARKERS):
        return "trader_principal"
    if COMMISSION_RE.search(blob):
        return "agency_commission"
    return "agency_commission"


def mailbox_dirs() -> list[Path]:
    return sorted(
        p
        for p in OUTPUT.iterdir()
        if p.is_dir()
        and p.name != "relevant"
        and (p / "threads.jsonl").exists()
        and (p / "messages.jsonl").exists()
    )


def main() -> int:
    started = time.time()
    print("Relevant deal extract v2 (reply chains + commercial model)")
    threads: list[dict[str, Any]] = []
    messages_by_id: dict[str, dict[str, Any]] = {}
    for mailbox_dir in mailbox_dirs():
        print(f"  loading {mailbox_dir.name}…")
        threads.extend(load_jsonl(mailbox_dir / "threads.jsonl"))
        for row in load_jsonl(mailbox_dir / "messages.jsonl"):
            messages_by_id[row["id"]] = row

    kept_threads = [t for t in threads if is_relevant(t)]
    dropped = len(threads) - len(kept_threads)
    print(
        f"  threads {len(threads):,}  relevant {len(kept_threads):,}  dropped {dropped:,}"
    )

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for thread in kept_threads:
        groups[deal_id_for(thread)].append(thread)

    RELEVANT_DIR.mkdir(parents=True, exist_ok=True)
    deals_path = RELEVANT_DIR / "deals.jsonl"
    index_path = RELEVANT_DIR / "deals-index.jsonl"
    deals = []
    stages = Counter()
    models = Counter()
    party_counter = Counter()
    msg_total = 0
    doc_total = 0
    single_msg = 0

    with deals_path.open("w", encoding="utf-8") as deals_out, index_path.open(
        "w", encoding="utf-8"
    ) as index_out:
        for deal_key, group in sorted(
            groups.items(),
            key=lambda kv: max((t.get("date_end") or "") for t in kv[1]),
            reverse=True,
        ):
            msg_ids: list[str] = []
            seen_msg = set()
            for thread in group:
                for mid in thread.get("message_ids") or []:
                    if mid and mid not in seen_msg:
                        seen_msg.add(mid)
                        msg_ids.append(mid)
            packed = []
            for mid in msg_ids:
                row = messages_by_id.get(mid)
                if row:
                    packed.append(compact_message(row))
            packed.sort(key=lambda m: m.get("date") or "")

            # Drop topic-keyed single-mail junk unless strong PO/doc signal
            if (
                deal_key.startswith("topic:")
                and len(packed) < 2
                and not any(po_from_thread(t) for t in group)
            ):
                docs_early = sum(len(m.get("attachments") or []) for m in packed)
                roles_early = Counter(m.get("role") for m in packed)
                if docs_early == 0 or not (
                    roles_early.get("buyer")
                    or roles_early.get("factory")
                    or roles_early.get("trader")
                ):
                    continue

            docs = []
            seen_doc = set()
            for msg in packed:
                for att in msg.get("attachments") or []:
                    digest = att.get("sha256")
                    if digest in seen_doc:
                        continue
                    seen_doc.add(digest)
                    docs.append(att)
            roles: Counter[str] = Counter()
            parties: dict[str, set[str]] = {
                "buyer": set(),
                "factory": set(),
                "forwarder": set(),
                "trader": set(),
                "internal": set(),
            }
            for msg in packed:
                role = msg.get("role") or party_role(msg.get("from"))
                roles[role] += 1
                if role in parties and msg.get("from"):
                    parties[role].add(msg["from"].lower())
            for thread in group:
                for email in thread.get("parties") or []:
                    role = party_role(email)
                    if role in parties:
                        parties[role].add(email.lower())
            stage_list = sorted(
                {t.get("stage") or "other" for t in group},
                key=lambda s: STAGE_RANK.get(s, 99),
            )
            primary = "other"
            for candidate in (
                "commission",
                "payment",
                "booking",
                "inspection",
                "samples",
                "artwork",
                "pi_po",
                "quoting",
                "requirement",
            ):
                if candidate in stage_list:
                    primary = candidate
                    break
            dates = [m.get("date") for m in packed if m.get("date")]
            subjects = [t.get("subject") for t in group if t.get("subject")]
            mailboxes = sorted({t.get("mailbox") for t in group if t.get("mailbox")})
            pos = sorted({po_from_thread(t) for t in group if po_from_thread(t)})
            model = resolve_commercial_model(group, packed, parties)
            text = agent_text(packed)
            chain = [
                {
                    "n": i + 1,
                    "id": m.get("id"),
                    "date": m.get("date"),
                    "from": m.get("from"),
                    "role": m.get("role"),
                    "subject": m.get("subject"),
                    "in_reply_to": m.get("in_reply_to"),
                    "message_id": m.get("message_id"),
                }
                for i, m in enumerate(packed)
            ]
            deal = {
                "id": deal_key,
                "po_numbers": pos,
                "subject": subjects[0] if subjects else "",
                "subjects": subjects[:8],
                "primary_stage": primary,
                "stages": stage_list,
                "commercial_model": model,
                "mailboxes": mailboxes,
                "date_start": dates[0] if dates else None,
                "date_end": dates[-1] if dates else None,
                "message_count": len(packed),
                "doc_count": len(docs),
                "roles": dict(roles),
                "parties": {k: sorted(v) for k, v in parties.items() if v},
                "thread_ids": [t.get("id") for t in group],
                "documents": docs,
                "messages": packed,
                "chain": chain,
                "agent_email_text": text,
                "agent_email_text_chars": len(text),
            }
            index = {
                k: deal[k]
                for k in (
                    "id",
                    "po_numbers",
                    "subject",
                    "primary_stage",
                    "stages",
                    "commercial_model",
                    "mailboxes",
                    "date_start",
                    "date_end",
                    "message_count",
                    "doc_count",
                    "roles",
                    "parties",
                    "thread_ids",
                    "agent_email_text_chars",
                )
            }
            index["document_names"] = [d.get("name") for d in docs[:15]]
            deals_out.write(json.dumps(deal, ensure_ascii=False) + "\n")
            index_out.write(json.dumps(index, ensure_ascii=False) + "\n")
            deals.append(index)
            stages[primary] += 1
            models[model] += 1
            msg_total += len(packed)
            doc_total += len(docs)
            if len(packed) <= 1:
                single_msg += 1
            for bucket in parties.values():
                for email in bucket:
                    party_counter[email] += 1

    date_min = min((d.get("date_start") or "9999") for d in deals) if deals else None
    date_max = max((d.get("date_end") or "") for d in deals) if deals else None
    summary = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(time.time() - started, 1),
        "source_threads": len(threads),
        "relevant_threads": len(kept_threads),
        "dropped_threads": dropped,
        "deals": len(deals),
        "single_message_deals": single_msg,
        "messages": msg_total,
        "documents": doc_total,
        "date_start": date_min,
        "date_end": date_max,
        "stages": dict(stages),
        "commercial_models": dict(models),
        "top_parties": party_counter.most_common(20),
        "files": {
            "deals": str(deals_path),
            "index": str(index_path),
        },
        "note": "v2: reply-graph clusters, travel denylist, agency vs trader (Global Praise).",
    }
    (RELEVANT_DIR / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n  deals {len(deals):,}  messages {msg_total:,}  documents {doc_total:,}")
    print(f"  single-message {single_msg:,}  ({100 * single_msg / max(len(deals), 1):.0f}%)")
    print(f"  span {(date_min or '')[:10]} → {(date_max or '')[:10]}")
    print("  stages: " + ", ".join(f"{k} {v}" for k, v in stages.most_common()))
    print("  models: " + ", ".join(f"{k} {v}" for k, v in models.most_common()))
    print(f"  wrote {deals_path}")
    print(f"  wrote {index_path}")
    print(f"  {summary['elapsed_seconds']}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
