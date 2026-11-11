/**
 * Human-facing deal references for mailbox deals: PO number, booking number,
 * container number. The Deal Board code is built from the first of these that
 * the deal actually carries, so Ops and Finance read the same reference.
 */

const BOOKING_RE =
  /\b(?:booking|bkg|bkgconf)\s*(?:no\.?|number|#|conf(?:irmation)?)?\s*[#:.\-_ ]*\s*([A-Z0-9]{6,20})\b/gi;
const CONTAINER_RE = /\b([A-Z]{3}[UJZ]\d{7})\b/i;

/**
 * Trim a PO number captured from a subject down to the number itself.
 * "4353134-----VESSEL" → "4353134", "G2625146/PI2651WQ" → "G2625146",
 * "G 2625101//PLEASE" → "G2625101". A short "-12" suffix is kept.
 */
export function cleanPoNumber(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return null;
  const base = s.match(/^[A-Z]{0,3}\d[0-9A-Z]*/)?.[0];
  if (base) {
    const suffix = s.slice(base.length).match(/^-\d{1,3}(?![0-9A-Z])/)?.[0] || "";
    return base + suffix;
  }
  const trimmed = s.replace(/[-/]{2,}.*$/, "").replace(/^[-/]+|[-/]+$/g, "");
  return trimmed || null;
}

const PO_ANCHOR_RE =
  /\b(?:purchase\s+orders?|p\.?o\.?(?![a-z])|pono)(?:\s*(?:#|nos?\b\.?|numbers?\b|num\b))?[\s#:.\-]*/gi;
const PO_FIRST_RE = /^([A-Z]{1,2})?\s?(\d{4,12})[A-Z]{0,3}(?![0-9A-Z])/i;
const PO_NEXT_RE = /^\s*(?:,|&|\band\b|\/)\s*([A-Z]{1,2})?\s?(\d{2,12})[A-Z]{0,3}(?![0-9A-Z])/i;

/**
 * Every PO number written after a "PO" marker, including lists:
 * "PO # G 2625017, G 2625076, G 2525089" → G2625017, G2625076, G2525089
 * "po no. 4298868, 4298869" · "PO NO:- 4329768, 4329767" · "po no.3743941mx & 3744074mx"
 * "po no. 3793464, 467, 468" → 3793464, 3793467, 3793468 (short tails expand).
 * A list stops at a number of another length ("4255917 / 211004891" is a PO and a booking).
 * Destination suffixes (MX, TJ) are dropped. Keep in step with po_numbers_in() in
 * scripts/pst-extract/cluster_threads.py.
 */
export function poNumbersIn(text: string | null | undefined): string[] {
  const src = String(text ?? "");
  const out: string[] = [];
  const add = (po: string) => {
    if (!out.includes(po)) out.push(po);
  };
  for (const anchor of src.matchAll(PO_ANCHOR_RE)) {
    let rest = src.slice(anchor.index! + anchor[0].length, anchor.index! + anchor[0].length + 200);
    const first = rest.match(PO_FIRST_RE);
    if (!first) continue;
    const prefix = (first[1] || "").toUpperCase();
    const digits = first[2]!;
    add(prefix + digits);
    rest = rest.slice(first[0].length);
    for (let next = rest.match(PO_NEXT_RE); next; next = rest.match(PO_NEXT_RE)) {
      const p = (next[1] || "").toUpperCase();
      const d = next[2]!;
      if (d.length === digits.length) add((p || prefix) + d);
      else if (!p && d.length < digits.length && d.length <= 3) add(prefix + digits.slice(0, -d.length) + d);
      else break;
      rest = rest.slice(next[0].length);
    }
  }
  return out;
}

/** Cleaned, de-duplicated PO numbers in their original order. */
export function cleanPoNumbers(raw: (string | null | undefined)[] | null | undefined): string[] {
  const out: string[] = [];
  for (const p of raw || []) {
    const c = cleanPoNumber(p);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function cleanBooking(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return s.length >= 6 && /\d/.test(s) ? s : null;
}

/** First booking number written in the text ("booking # 067gx21075", "BKG 1234567"). */
export function bookingNumberIn(text: string | null | undefined): string | null {
  for (const m of String(text ?? "").matchAll(BOOKING_RE)) {
    const hit = cleanBooking(m[1]);
    if (hit) return hit;
  }
  return null;
}

/** ISO 6346 container number ("EGSU9502813"). */
export function containerNumberIn(text: string | null | undefined): string | null {
  return String(text ?? "").match(CONTAINER_RE)?.[1]?.toUpperCase() ?? null;
}

/** Short stable hash, so two deals never share a fallback code. */
function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

/** Party names worth putting in a code; the first one found in the subject wins. */
const PARTY_WORDS: [RegExp, string][] = [
  [/^praise$|^globalpraise/, "GP"],
  [/^waldos/, "WALDOS"],
  [/^shetler/, "SHETLER"],
  [/^homeline/, "HOMELINE"],
  [/^britt?ann?ia|^britindia/, "BRITANNIA"],
  [/^nirmal/, "NIRMAL"],
  [/^anupama|^annupamma/, "ANUPAMA"],
  [/^protec/, "PROTEC"],
  [/^castl?a?y/, "CASTLAY"],
  [/^bhanu/, "BHANUJYOT"],
  [/^jaypee/, "JAYPEE"],
  [/^bector/, "BECTOR"],
  [/^vizion|^grupovizion/, "VIZION"],
  [/^petrageous/, "PETRAGEOUS"],
  [/^swastik/, "SWASTIK"],
  [/^neater/, "NEATER"],
  [/^allana/, "ALLANA"],
  [/^ruparel/, "RUPAREL"],
  [/^fisan/, "FISAN"],
];

/** Words that say nothing about which deal it is. */
const GENERIC_WORDS = new Set(
  (
    "topic re fw fwd aw top urgent very the and for from with to of on in at by our your " +
    "please kindly regarding reg dear new non receipt received status update updates " +
    "document documents docs request details detail info information mail email query " +
    "order orders shipment shipments payment payments invoice invoices booking bookings " +
    "pending reminder follow followup final revised copy attached against number no " +
    "limited ltd pvt private llp company global invocie inv required needed spam"
  ).split(" "),
);

/** One readable word for a deal with no PO, booking or container number. */
function labelFor(text: string): string | null {
  const words = text
    .toLowerCase()
    .replace(/^(topic|po|bkg|id):/, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && /[a-z]/.test(w) && !GENERIC_WORDS.has(w));
  for (const w of words) {
    const party = PARTY_WORDS.find(([re]) => re.test(w));
    if (party) return party[1];
  }
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  return longest ? longest.slice(0, 10).toUpperCase() : null;
}

/**
 * Deal Board code, in order of preference:
 * PO-<po> · BKG-<booking> · CNTR-<container> · MB-<word>-<hash>.
 * The hash suffix keeps two deals about the same party apart.
 */
export function dealCodeFor(input: {
  id: string;
  poNumbers?: (string | null | undefined)[] | null;
  subject?: string | null;
  bookingNumber?: string | null;
}): string {
  const id = input.id || "";
  const fromId = id.startsWith("po:") ? cleanPoNumber(id.slice(3)) : null;
  const pos = cleanPoNumbers(input.poNumbers);
  const po = fromId && pos.includes(fromId) ? fromId : pos[0] || fromId;
  if (po) return `PO-${po.slice(0, 16)}`;

  const text = `${id} ${input.subject || ""}`;
  const booking = cleanBooking(input.bookingNumber) || bookingNumberIn(text);
  if (booking) return `BKG-${booking}`;

  const container = containerNumberIn(text);
  if (container) return `CNTR-${container}`;

  const hash = shortHash(id || "deal");
  const label = labelFor(`${id.startsWith("topic:") ? id : ""} ${input.subject || ""}`);
  return label ? `MB-${label}-${hash.slice(-4)}` : `MB-${hash}`;
}
