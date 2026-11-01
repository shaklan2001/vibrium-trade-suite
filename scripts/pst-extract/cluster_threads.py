#!/usr/bin/env python3
"""Cluster extracted PST messages into deal-ish threads. Local, no LLM.

Groups by Message-ID / In-Reply-To first, then PO / freight booking IDs.
Drops travel/admin noise. Labels party role, stage, and commercial model
(agency_commission vs trader_principal for Global Praise).

Usage:
  python cluster_threads.py
  python cluster_threads.py --mailbox kalpana_at_snspl_in_outlook
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "data" / "pst_extract"

NOISE_DOMAINS = (
    "bsesdelhi.com",
    "vodafoneidea.com",
    "icicibank.com",
    "icici.bank.in",
    "hdfc",
    "tatapower",
    "airtel.com",
    "justdial.com",
    "hsbc.com",
    "lombard",
    "newsletter",
    "godaddy",
    "facebookmail.com",
    "linkedin.com",
    "mailchimp",
    "sendgrid.net",
    "subscribe.",
    "notification.",
    "no-reply",
    "noreply",
    "noresponse",
    "agoda.com",
    "airindia.com",
    "goindigo.in",
    "makemytrip.com",
    "booking.com",
    "expedia.",
    "irctc.",
    "mapyourshow.com",
)

BUYER_DOMAINS = {
    "petrageousdesigns.com": "Petrageous",
    "lovingpetsproducts.com": "Loving Pets",
    "thepetdimension.com": "The Pet Dimension",
    "babyking.com": "Baby King",
    "hut.com.mx": "HUT Internacional",
    "neaterpets.com": "Neater",
    "shetler.com": "Shetler",
    "waldos.com": "Waldos",
    "grupovizion.com.mx": "Grupo Vizion",
}

FACTORY_DOMAINS = {
    "cottonsmiths.com": "Cotton Smiths",
    "swastikimpex.org": "Swastik",
    "aditiartswares@yahoo.co.in": "Aditi Arts",
    "allana.com": "Allana",
    "rajaryanexport.com": "Raj Aryan",
    "ruparelindia.com": "Ruparel",
    "centuryfilaments.com": "New Century",
    "riexports.com": "RI Exports",
    "snbenterprises.com": "SNB",
    "ykindustries.co.in": "YK Industries",
    "protectools.cn": "Protectools",
    "agrofoods.net": "Agro Foods",
}

FORWARDER_DOMAINS = {
    "icl-india.com": "ICL",
    "skyline-freight.com": "Skyline Freight",
    "mentor-freight.com": "Mentor Freight",
    "wacbangladesh.com": "WAC Logistics",
    "c-air.com": "C-Air",
    "expeditors.com": "Expeditors",
    "britindia.com": "Brit India",
    "cardinalgl.com": "Cardinal",
    "deigratialogistics.com": "Dei Gratia",
    "avmcargo.com": "AVM Cargo",
    "in-asgroup.com": "AS Group",
    "pfmlindia.com": "PFML",
}

# Global Praise = trader principal (not SNSPL agency commission book)
TRADER_MARKERS = (
    "globalpraisehk@gmail.com",
    "global praise",
    "globalpraise",
)

INTERNAL_DOMAINS = ("snspl.in",)

# Freight booking signals — bare "booking" alone is NOT enough (hotels/flights)
FREIGHT_RE = re.compile(
    r"\b(1\s*x\s*40|1\s*x\s*20|40['’]?\s*hc|20['’]?\s*gp|"
    r"\bh/?bl\b|\bm/?bl\b|bl draft|container|vgm|"
    r"etd|eta\b|sailing|nhava\s*sheva|navasheva|mundra|"
    r"forwarder|shipping bill|gated in|si submitted|"
    r"cnee|shipper:|consignee|bill of lading|telex release|"
    r"bkgconf|ocean freight|pol\b|pod\b)\b",
    re.I,
)
PO_RE = re.compile(r"\bpo[#\s:-]*([a-z]?\s?\d[\dA-Za-z/-]{2,})", re.I)
# Real freight booking refs only — no "booking confirmation" / "document"
BOOKING_ID_RE = re.compile(
    r"\b(?:bkg|ebkg|bkgconf)[#\s:_-]*([A-Z0-9]{6,})\b",
    re.I,
)
RFQ_RE = re.compile(
    r"\b(enquiry|inquiry|requirement|please quote|need pric|looking for|"
    r"new item|new product|can you source|rfq|reorder)\b",
    re.I,
)
QUOTE_RE = re.compile(r"\b(quotation|as sheet|price list|costing|fob\b)\b", re.I)
PI_RE = re.compile(r"\b(proforma|\bpi\b|purchase order)\b", re.I)
SAMPLE_RE = re.compile(r"\b(sample|proto|strike off|lab dip)\b", re.I)
ARTWORK_RE = re.compile(r"\b(artwork|dieline|print file)\b", re.I)
QC_RE = re.compile(r"\b(inspection|qc\b|aql)\b", re.I)
PAY_RE = re.compile(
    r"\b(payment|remittance|\btt\b|\blc\b|outstanding|payment remitted)\b",
    re.I,
)
COMMISSION_RE = re.compile(r"\b(commission\s+invoice|agency\s+commission|qtr\s+commission)\b", re.I)
RE_PREFIX = re.compile(r"^(re|fw|fwd|aw|sv):\s*", re.I)

TRAVEL_ADMIN_RE = re.compile(
    r"\b(agoda|air\s*india|indigo|eticket|e-ticket|hotel|flight booking|"
    r"booth assignment|mapyourshow|interzoo|plant renewal|bond renewal|"
    r"buchung|customer receipt from booking id|make\s*my\s*trip|"
    r"gst pending|stand\b.*expo|expo\s+202[0-9].*booth|"
    r"msme|tds\b|reimbursement of tds|ledger statement|account ledger|"
    r"registration status|section\s*232|tariff\b.*steel|"
    r"credit card statement|electricity bill|estatement|"
    r"appa\b|membership dues|membership invoice|association dues|"
    r"reversal of credit note|global ledger|soa global praise)\b",
    re.I,
)

BKG_BLACKLIST = {
    "CONFIRMATION",
    "CUMENT",
    "CUMENTS",
    "ETICKET",
    "LLARAMA",
    "NUMBER",
    "DETAILS",
    "STATUS",
}


def domain_of(email: str | None) -> str:
    if not email or "@" not in email:
        return ""
    return email.split("@", 1)[1].lower().strip(">")


def matches_any(text: str, needles: tuple[str, ...] | dict[str, str]) -> str | None:
    blob = text.lower()
    items = needles.keys() if isinstance(needles, dict) else needles
    for item in items:
        if item.lower() in blob:
            return item
    return None


def is_trader_email(email: str | None) -> bool:
    em = (email or "").lower()
    return any(m in em for m in TRADER_MARKERS if "@" in m)


def party_role(email: str | None) -> str:
    em = (email or "").lower()
    if matches_any(em, INTERNAL_DOMAINS):
        return "internal"
    if is_trader_email(em) or "globalpraise" in em:
        return "trader"
    if matches_any(em, BUYER_DOMAINS):
        return "buyer"
    if matches_any(em, FACTORY_DOMAINS) or "aditiartswares" in em:
        return "factory"
    if matches_any(em, FORWARDER_DOMAINS):
        return "forwarder"
    if matches_any(em, NOISE_DOMAINS):
        return "noise"
    return "other"


def is_noise_message(row: dict[str, Any]) -> bool:
    sender = (row.get("sender_email") or "").lower()
    if party_role(sender) == "noise":
        return True
    subj = (row.get("subject") or "")
    if TRAVEL_ADMIN_RE.search(subj):
        return True
    low = subj.lower()
    if "credit card" in low or "estatement" in low or "electricity bill" in low:
        return True
    return False


def norm_topic(row: dict[str, Any]) -> str:
    raw = row.get("conversation_topic") or row.get("subject") or ""
    text = RE_PREFIX.sub("", raw).strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text[:180]


def po_key(text: str) -> str | None:
    match = PO_RE.search(text or "")
    if not match:
        return None
    return re.sub(r"\s+", "", match.group(1)).upper().strip("-/")


def booking_key(text: str) -> str | None:
    match = BOOKING_ID_RE.search(text or "")
    if not match:
        return None
    key = match.group(1).upper()
    if key in BKG_BLACKLIST or len(key) < 6:
        return None
    if key.isalpha() and len(key) < 8:
        return None
    return key


def stage_of(subject: str, body: str) -> str:
    text = f"{subject} {body[:1500]}"
    if COMMISSION_RE.search(text):
        return "commission"
    freight = bool(FREIGHT_RE.search(text))
    if freight:
        return "booking"
    if SAMPLE_RE.search(text):
        return "samples"
    if ARTWORK_RE.search(text):
        return "artwork"
    if QC_RE.search(text):
        return "inspection"
    if PI_RE.search(text) or po_key(subject):
        return "pi_po"
    if QUOTE_RE.search(text):
        return "quoting"
    if RFQ_RE.search(text) and not freight:
        return "requirement"
    if PAY_RE.search(text):
        return "payment"
    return "other"


def commercial_model_of(
    items: list[dict[str, Any]],
    roles: Counter[str],
    subject: str,
    body: str,
) -> str:
    """agency_commission (SNSPL referee) vs trader_principal (Global Praise buy/sell)."""
    blob = f"{subject} {body}".lower()
    if any(m in blob for m in TRADER_MARKERS):
        return "trader_principal"
    if roles.get("trader", 0) > 0:
        return "trader_principal"
    for row in items:
        for field in ("sender_email", "display_to", "display_cc"):
            if is_trader_email(row.get(field)) or "globalpraise" in (
                row.get(field) or ""
            ).lower():
                return "trader_principal"
        for addr in row.get("to") or []:
            email = addr.get("email") if isinstance(addr, dict) else str(addr)
            if is_trader_email(email) or "globalpraise" in (email or "").lower():
                return "trader_principal"
    if COMMISSION_RE.search(blob):
        return "agency_commission"
    if roles.get("buyer", 0) > 0 and roles.get("factory", 0) > 0:
        return "agency_commission"
    if roles.get("buyer", 0) > 0:
        return "agency_commission"
    return "agency_commission"


def useful_attachments(row: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for att in row.get("attachments") or []:
        if att.get("skipped") or att.get("inline"):
            continue
        kind = (att.get("kind") or "").lower()
        name = (att.get("name") or "").lower()
        if kind in {"png", "jpeg", "gif", "tiff"} or name.endswith(
            (".png", ".jpg", ".jpeg", ".gif")
        ):
            continue
        if not att.get("path"):
            continue
        out.append(
            {
                "name": att.get("name"),
                "kind": att.get("kind"),
                "path": att.get("path"),
                "sha256": att.get("sha256"),
                "mailbox": row.get("mailbox"),
            }
        )
    return out


def agent_slot(stage: str) -> str | None:
    return {
        "requirement": "requirement_extractor",
        "quoting": "quote_normalizer",
        "pi_po": "pi_parser",
        "booking": "booking_parser",
        "artwork": "artwork_checklist",
        "samples": "sample_tracker",
        "inspection": "inspection_notes",
        "payment": "payment_tracker",
        "commission": "commission_checklist",
    }.get(stage)


def load_mailbox(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, x: str) -> None:
        if x not in self.parent:
            self.parent[x] = x

    def find(self, x: str) -> str:
        self.add(x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def normalize_msgid(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    # Take first token if multiple
    text = text.split()[0].strip("<> \t\"'")
    return text.lower() if text else None


def cluster_by_reply_graph(messages: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Union messages that share Message-ID / In-Reply-To, then PO, then booking, then topic."""
    uf = UnionFind()
    row_by_local: dict[str, dict[str, Any]] = {}
    msgid_to_local: dict[str, str] = {}

    for row in messages:
        local = row.get("id")
        if not local:
            continue
        row_by_local[local] = row
        uf.add(local)
        mid = normalize_msgid(row.get("message_id"))
        if mid:
            if mid in msgid_to_local:
                uf.union(local, msgid_to_local[mid])
            else:
                msgid_to_local[mid] = local

    for row in messages:
        local = row.get("id")
        if not local:
            continue
        parent = normalize_msgid(row.get("in_reply_to"))
        if parent and parent in msgid_to_local:
            uf.union(local, msgid_to_local[parent])

    # Secondary: merge components that share a strong PO
    po_roots: dict[str, str] = {}
    for local, row in row_by_local.items():
        blob = f"{row.get('subject') or ''} {row.get('conversation_topic') or ''}"
        po = po_key(blob)
        if not po:
            continue
        root = uf.find(local)
        if po in po_roots:
            uf.union(root, po_roots[po])
        else:
            po_roots[po] = root

    # Tertiary: freight booking IDs only
    bkg_roots: dict[str, str] = {}
    for local, row in row_by_local.items():
        blob = f"{row.get('subject') or ''} {row.get('conversation_topic') or ''}"
        bkg = booking_key(blob)
        if not bkg:
            continue
        root = uf.find(local)
        if bkg in bkg_roots:
            uf.union(root, bkg_roots[bkg])
        else:
            bkg_roots[bkg] = root

    components: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for local, row in row_by_local.items():
        components[uf.find(local)].append(row)

    # Label each component with a stable deal-ish key
    labeled: dict[str, list[dict[str, Any]]] = {}
    for items in components.values():
        items.sort(key=lambda r: r.get("date") or "")
        key = component_key(items)
        if key in labeled:
            labeled[key].extend(items)
            labeled[key].sort(key=lambda r: r.get("date") or "")
        else:
            labeled[key] = items
    return labeled


def component_key(items: list[dict[str, Any]]) -> str:
    for row in items:
        blob = f"{row.get('subject') or ''} {row.get('conversation_topic') or ''}"
        po = po_key(blob)
        if po:
            return f"po:{po}"
    for row in items:
        blob = f"{row.get('subject') or ''} {row.get('conversation_topic') or ''}"
        bkg = booking_key(blob)
        if bkg:
            return f"bkg:{bkg}"
    # Prefer conversation topic of first message if shared
    topics = [norm_topic(r) for r in items if norm_topic(r)]
    if topics:
        # Use most common topic among the chain
        topic = Counter(topics).most_common(1)[0][0]
        return f"topic:{topic}"
    mid = items[0].get("message_id") or items[0].get("id")
    return f"id:{mid}"


def cluster_mailbox(out_dir: Path) -> dict[str, Any]:
    messages = load_mailbox(out_dir / "messages.jsonl")
    clean: list[dict[str, Any]] = []
    dropped = 0
    for row in messages:
        if is_noise_message(row):
            dropped += 1
            continue
        clean.append(row)

    groups = cluster_by_reply_graph(clean)

    threads = []
    stages: Counter[str] = Counter()
    models: Counter[str] = Counter()
    worthy = 0
    for key, items in groups.items():
        items.sort(key=lambda r: r.get("date") or "")
        senders = [(r.get("sender_email") or "") for r in items]
        roles = Counter(party_role(s) for s in senders if s)
        dates = [r.get("date") for r in items if r.get("date")]
        subj = items[-1].get("subject") or items[0].get("subject") or ""
        bodies = " ".join((r.get("body_text") or "")[:800] for r in items[:5])
        stage = stage_of(subj, bodies)
        model = commercial_model_of(items, roles, subj, bodies)
        docs: list[dict[str, Any]] = []
        seen = set()
        for r in items:
            for att in useful_attachments(r):
                digest = att.get("sha256")
                if digest in seen:
                    continue
                seen.add(digest)
                docs.append(att)
        has_buyer = roles.get("buyer", 0) > 0
        has_factory = roles.get("factory", 0) > 0
        has_trader = roles.get("trader", 0) > 0
        has_forwarder = roles.get("forwarder", 0) > 0
        has_po = key.startswith("po:")
        freightish = stage == "booking" or bool(FREIGHT_RE.search(f"{subj} {bodies}"))
        agent_ok = (
            (
                stage in {
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
                and (
                    has_buyer
                    or has_factory
                    or has_trader
                    or has_po
                    or (has_forwarder and freightish)
                    or (len(docs) > 0 and (has_po or freightish))
                )
            )
            or (has_po and (has_buyer or has_factory or has_trader or has_forwarder or docs))
        ) and roles.get("noise", 0) < len(items)
        # Drop pure travel leftovers that somehow passed
        if TRAVEL_ADMIN_RE.search(subj) and not has_po:
            agent_ok = False
        if agent_ok:
            worthy += 1
        stages[stage] += 1
        models[model] += 1
        parties = sorted(
            {
                s.lower()
                for s in senders
                if s
                and party_role(s) in {"buyer", "factory", "forwarder", "trader", "internal"}
            }
        )
        # Build ordered reply chain meta
        chain = [
            {
                "id": r.get("id"),
                "message_id": r.get("message_id"),
                "in_reply_to": r.get("in_reply_to"),
                "date": r.get("date"),
                "from": r.get("sender_email"),
                "subject": r.get("subject"),
            }
            for r in items
        ]
        threads.append(
            {
                "id": key,
                "mailbox": out_dir.name,
                "subject": subj,
                "stage": stage,
                "commercial_model": model,
                "agent_slot": agent_slot(stage) if agent_ok else None,
                "agent_worthy": agent_ok,
                "message_count": len(items),
                "date_start": dates[0] if dates else None,
                "date_end": dates[-1] if dates else None,
                "roles": dict(roles),
                "parties": parties[:16],
                "docs": docs[:20],
                "doc_count": len(docs),
                "message_ids": [r.get("id") for r in items],
                "chain": chain,
            }
        )

    threads.sort(key=lambda t: t.get("date_end") or "", reverse=True)
    dest = out_dir / "threads.jsonl"
    with dest.open("w", encoding="utf-8") as handle:
        for thread in threads:
            handle.write(json.dumps(thread, ensure_ascii=False) + "\n")

    summary = {
        "mailbox": out_dir.name,
        "messages": len(messages),
        "dropped_noise": dropped,
        "threads": len(threads),
        "agent_worthy": worthy,
        "stages": dict(stages),
        "commercial_models": dict(models),
        "output": str(dest),
    }
    (out_dir / "threads-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def mailbox_dirs(output: Path, only: str | None) -> list[Path]:
    dirs = sorted(
        p for p in output.iterdir() if p.is_dir() and (p / "messages.jsonl").exists()
    )
    if only:
        dirs = [p for p in dirs if p.name == only]
    if not dirs:
        raise SystemExit(f"No extracted mailboxes in {output}")
    return dirs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--mailbox")
    args = parser.parse_args()
    dirs = mailbox_dirs(args.output, args.mailbox)
    print("Thread cluster v2 (reply-graph + PO, local, no LLM)")
    started = time.time()
    results = []
    for out_dir in dirs:
        print(f"\n== {out_dir.name} ==")
        summary = cluster_mailbox(out_dir)
        results.append(summary)
        print(
            f"  messages {summary['messages']:,}  dropped noise {summary['dropped_noise']:,}  "
            f"threads {summary['threads']:,}  agent-worthy {summary['agent_worthy']:,}"
        )
        stages = sorted(summary["stages"].items(), key=lambda kv: -kv[1])
        print("  stages: " + ", ".join(f"{k} {v}" for k, v in stages))
        models = sorted(summary["commercial_models"].items(), key=lambda kv: -kv[1])
        print("  models: " + ", ".join(f"{k} {v}" for k, v in models))
    (args.output / "threads-run-summary.json").write_text(
        json.dumps(
            {
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "elapsed_seconds": round(time.time() - started, 1),
                "results": results,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote threads.jsonl next to each mailbox ({human(time.time() - started)})")
    return 0


def human(seconds: float) -> str:
    s = int(seconds)
    return f"{s}s" if s < 60 else f"{s // 60}m {s % 60:02d}s"


if __name__ == "__main__":
    raise SystemExit(main())
