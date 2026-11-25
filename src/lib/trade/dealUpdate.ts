/**
 * Off-mail deal updates: things that happened on WhatsApp, a phone call or in a meeting,
 * told to Copilot in plain words ("buyer sent $5K on WhatsApp for PO 15269").
 *
 *   detectDealUpdate()  → is this message an update (not a question)? what does it say?
 *   the server resolves the deal and returns a proposal; nothing is saved until the
 *   person confirms it in the Copilot card (src/components/copilot/deal-update-card.tsx).
 *
 * Client-safe and pure (no I/O).
 */
import type { PaymentKind, PaymentSide } from "@/lib/mail/payments";

export type DealUpdateType = "payment" | "note";
export type DealUpdateChannel = "whatsapp" | "phone" | "meeting" | "other";

export const CHANNEL_LABEL: Record<DealUpdateChannel, string> = {
  whatsapp: "WhatsApp",
  phone: "Phone call",
  meeting: "Meeting",
  other: "Other",
};

export const PAYMENT_KIND_LABEL: Record<Exclude<PaymentKind, "other">, string> = {
  payment_received: "Payment received",
  payment_sent: "Payment sent",
  payment_request: "Payment requested",
};

export const SIDE_LABEL: Record<PaymentSide, string> = {
  buyer: "Buyer",
  factory: "Factory",
  freight: "Freight",
  commission: "Commission",
  other: "Other",
};

export type DealUpdatePayment = {
  kind: Exclude<PaymentKind, "other">;
  side: PaymentSide;
  /** null when the message did not state one — the card asks for it. */
  amount: number | null;
  /** null when not stated; the server fills the deal's currency. */
  currency: string | null;
  /** YYYY-MM-DD */
  date: string;
  reference: string | null;
};

export type ParsedDealUpdate = {
  type: DealUpdateType;
  channel: DealUpdateChannel;
  payment: DealUpdatePayment | null;
  /** The update in the person's words, without "log that" / "copilot". */
  note: string;
  /** Text with money and update words removed — what is left names the deal. */
  dealText: string;
};

/** A deal the update can be filed on (the card lets the person switch between these). */
export type DealUpdateDealRef = {
  id: string;
  key: string;
  code: string;
  title: string;
  href: string;
  /** Orders on the deal; a payment is booked against one of them. */
  pos: string[];
  currency: string | null;
};

export type DealUpdateProposal = ParsedDealUpdate & {
  /** Stable id — confirming twice saves once. */
  id: string;
  deal: DealUpdateDealRef | null;
  candidates: DealUpdateDealRef[];
  po: string | null;
  /** Why no deal was picked, shown in the card. */
  dealHint: string | null;
};

/** What the confirm card sends back (the person may have edited any of it). */
export type DealUpdateInput = {
  id: string;
  type: DealUpdateType;
  dealId: string;
  po: string | null;
  channel: DealUpdateChannel;
  note: string;
  author: string;
  payment: DealUpdatePayment | null;
  sourceText: string;
};

export type DealUpdateRecord = {
  id: string;
  type: DealUpdateType;
  dealId: string;
  dealKey: string;
  dealCode: string;
  dealTitle: string;
  href: string;
  po: string | null;
  channel: DealUpdateChannel;
  author: string;
  note: string;
  summary: string;
  payment: DealUpdatePayment | null;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
};

/* ------------------------------------------------------------------ detection */

const QUESTION_START =
  /^(?:what|which|how|did|does|do|has|have|is|are|was|were|when|who|whom|whose|why|where|can|could|would|should|will|show|list|summari[sz]e|tell me|give me|find|search|explain|any)\b/i;
const COMMAND =
  /^(?:please\s+)?(?:log|record|note|add(?:\s+a)?\s+note|update|mark|save|book)\b|\b(?:log|record|note|update) (?:this|that|it)\b|\bupdate (?:the )?(?:deal|po|order)\b|\b(?:add|put) (?:this|that|it) (?:to|on|in) (?:the )?(?:deal|po|order)\b/i;
const OFF_MAIL =
  /\b(?:whats\s?app|wa msg|on wa|phone|call(?:ed)?|rang|spoke|talked|told (?:me|us)|said|says|confirmed|informed|verbally|meeting|met|in person|visit(?:ed)?)\b/i;

const RECEIVED =
  /\b(?:received|receive|recd|rcvd|got|credited|came in|realised|realized|landed|mil (?:gay[ae]|gya|gaye)|aa (?:gay[ae]|gya|gaye)|aay[ae]|aaya|mila|mile)\b/i;
const SENT =
  /\b(?:paid|pay|sent|send|transferred|remitted|wired|released|cleared|bhej (?:diy[ae]|di|de)|bheje|bheja|de diy[ae]|kar diy[ae])\b/i;
const REQUESTED =
  /\b(?:requested|request(?:ing)?|asked for|asking for|wants|demand(?:ed|ing)?|raised (?:an? )?invoice|invoiced|chahiye|maang)\b/i;
const WE = /\b(?:we|us|i|our|savvy|snspl)\b/i;

const FACTORY = /\b(?:factory|supplier|vendor|manufacturer|mill)\b/i;
const FREIGHT = /\b(?:freight|forwarder|shipping line|liner|cha|transport)\b/i;
const COMMISSION = /\b(?:commission|brokerage)\b/i;

const CURRENCY_WORDS: [RegExp, string][] = [
  [/^(?:\$|us\$|usd|dollars?|dollar)$/i, "USD"],
  [/^(?:₹|inr|rs\.?|rupees?|rupay)$/i, "INR"],
  [/^(?:€|eur|euros?)$/i, "EUR"],
  [/^(?:£|gbp|pounds?)$/i, "GBP"],
  [/^(?:aed|dirhams?)$/i, "AED"],
  [/^(?:cny|rmb|yuan)$/i, "CNY"],
];
const CCY = String.raw`(?:us\$|\$|₹|€|£|usd|inr|rs\.?|rupees?|rupay|eur|euros?|gbp|pounds?|aed|dirhams?|cny|rmb|yuan|dollars?)`;
const MULT = String.raw`(?:k|thousand|lakhs?|lacs?|lac|l|cr|crores?|m|mn|million)`;
const AMOUNT_RE = new RegExp(
  String.raw`(?<![\w.])(?:(${CCY})\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(${MULT})?\b\s*(${CCY})?(?![\w])`,
  "gi",
);

function currencyOf(word: string | undefined): string | null {
  if (!word) return null;
  const w = word.trim();
  for (const [re, code] of CURRENCY_WORDS) if (re.test(w)) return code;
  return null;
}

function multiplier(m: string | undefined): number {
  const x = (m || "").toLowerCase();
  if (x === "k" || x === "thousand") return 1_000;
  if (/^(?:lakhs?|lacs?|lac|l)$/.test(x)) return 100_000;
  if (/^(?:cr|crores?)$/.test(x)) return 10_000_000;
  if (/^(?:m|mn|million)$/.test(x)) return 1_000_000;
  return 1;
}

type AmountHit = { amount: number; currency: string | null; start: number; end: number; strong: boolean };

/** Money in the text. "Strong" hits carry a currency or a k / lakh suffix (PO numbers never do). */
export function amountsIn(text: string): AmountHit[] {
  const out: AmountHit[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const [, pre, num, mult, post] = m;
    const value = Number(num!.replace(/,/g, "")) * multiplier(mult);
    if (!Number.isFinite(value) || value <= 0) continue;
    const ccy = currencyOf(pre) || currencyOf(post);
    const indian = /^(?:lakhs?|lacs?|lac|l|cr|crores?)$/i.test(mult || "");
    out.push({
      amount: Math.round(value * 100) / 100,
      currency: ccy || (indian ? "INR" : null),
      start: m.index!,
      end: m.index! + m[0].length,
      strong: Boolean(ccy || mult),
    });
  }
  return out;
}

function pickAmount(text: string): AmountHit | null {
  const hits = amountsIn(text);
  const strong = hits.find((h) => h.strong);
  if (strong) return strong;
  // A bare number right after a money verb: "received 5000", "paid 12,500".
  const verb = /\b(?:received|recd|rcvd|got|paid|sent|transferred|remitted|requested|asked for|credited)\s+(?:of\s+|about\s+|around\s+)?$/i;
  return hits.find((h) => verb.test(text.slice(Math.max(0, h.start - 30), h.start)) && !/^\d{4}$/.test(String(h.amount))) || null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The date the money moved: today unless the message says otherwise. */
export function dateIn(text: string, now = new Date()): string {
  if (/\byesterday\b|\bkal\b/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return ymd(d);
  }
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/.exec(text);
  if (dmy) {
    const y = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]!;
    const mo = Number(dmy[2]);
    const da = Number(dmy[1]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${y}-${pad(mo)}-${pad(da)}`;
  }
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(
    text,
  );
  if (named) {
    const day = Number(named[1] || named[4]);
    const mon = MONTHS.indexOf((named[2] || named[3])!.toLowerCase().slice(0, 3));
    if (day >= 1 && day <= 31 && mon >= 0) {
      let y = now.getFullYear();
      if (new Date(y, mon, day) > now) y -= 1; // "12 Dec" said in November means last year
      return `${y}-${pad(mon + 1)}-${pad(day)}`;
    }
  }
  return ymd(now);
}

function channelIn(text: string): DealUpdateChannel {
  if (/\bwhats\s?app\b|\bwa msg\b|\bon wa\b/i.test(text)) return "whatsapp";
  if (/\b(?:phone|call(?:ed)?|rang|spoke|talked)\b/i.test(text)) return "phone";
  if (/\b(?:meeting|met|in person|visit(?:ed)?)\b/i.test(text)) return "meeting";
  return "other";
}

function referenceIn(text: string): string | null {
  const m = /\b(?:ref(?:erence)?|utr|txn|transaction|swift|mt103)\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{4,40})\b/i.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

/** Remove "copilot, log that" and similar so the saved note reads like the update itself. */
function cleanNote(text: string): string {
  return text
    .replace(/^\s*(?:hey\s+|hi\s+)?(?:copilot|savvy)[\s,:-]*/i, "")
    .replace(/^\s*(?:please\s+)?(?:log|record|note|save|update|mark)(?:\s+(?:this|that|it))?(?:\s+(?:down|in|on))?\s*[:,-]?\s*(?:that\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
    .slice(0, 2000);
}

const UPDATE_WORDS =
  /\b(?:log|record|note|update|mark|save|book|copilot|savvy|please|pls|that|this|received|receive|recd|rcvd|got|credited|came|in|paid|pay|sent|send|transferred|remitted|wired|released|requested|request|asked|asking|wants|payment|payments|advance|balance|money|amount|today|yesterday|whatsapp|whats|app|phone|call|called|spoke|told|said|says|confirmed|informed|meeting|met|person|from|to|for|on|by|via|of|the|a|an|we|us|i|our|me|he|she|they|has|have|had|is|was|just|already|deal|po|order|ref|utr|aa|gaya|gaye|gya|mil|mila|bhej|bheja|bheje|diya|diye|di|de|kar|ne|dollars?|lakhs?|lacs?|utr|ka|ki|ke|se|hai|ho)\b/gi;

/**
 * Is this message an update to record (not a question)? Returns what it says, or null.
 * Deliberately conservative: a miss falls through to a normal Copilot answer, and
 * every hit is shown to the person for confirmation before anything is saved.
 */
export function detectDealUpdate(raw: string, now = new Date()): ParsedDealUpdate | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 2000) return null;
  const command = COMMAND.test(text);
  const question = text.endsWith("?") || QUESTION_START.test(text);
  if (question && !command) return null;

  const hit = pickAmount(text);
  const received = RECEIVED.test(text);
  const sent = SENT.test(text);
  const requested = REQUESTED.test(text);
  const moneyVerb = received || sent || requested;
  const offMail = OFF_MAIL.test(text);

  const isPayment = Boolean(hit && moneyVerb) || Boolean(command && moneyVerb && /\b(?:payment|advance|balance|money)\b/i.test(text));
  if (!isPayment && !(command || (offMail && text.split(" ").length >= 4))) return null;

  const channel = channelIn(text);
  const note = cleanNote(text);
  let dealText = text;
  if (hit) dealText = `${dealText.slice(0, hit.start)} ${dealText.slice(hit.end)}`;
  const ref = referenceIn(text);
  if (ref) dealText = dealText.replace(new RegExp(ref.replace(/[^A-Z0-9]/gi, "."), "i"), " ");
  dealText = dealText
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d+(?:\.\d+)?%/gi, " ")
    .replace(UPDATE_WORDS, " ")
    .replace(/[^\w\s@.&'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!isPayment) return { type: "note", channel, payment: null, note, dealText };

  const factory = FACTORY.test(text);
  const side: PaymentSide = COMMISSION.test(text) ? "commission" : FREIGHT.test(text) ? "freight" : factory ? "factory" : "buyer";
  let kind: DealUpdatePayment["kind"];
  if (requested && !received && !sent) kind = "payment_request";
  else if (received) kind = "payment_received";
  else if (side === "buyer" && !WE.test(text.replace(/\b(?:told|informed) (?:me|us)\b/gi, ""))) {
    // "Buyer sent 5K" — the payer says it is sent; it counts as received once confirmed.
    kind = "payment_sent";
  } else if (side === "buyer") kind = "payment_received";
  else kind = "payment_sent"; // we paid the factory / forwarder

  return {
    type: "payment",
    channel,
    note,
    dealText,
    payment: {
      kind,
      side,
      amount: hit?.amount ?? null,
      currency: hit?.currency ?? null,
      date: dateIn(text, now),
      reference: ref,
    },
  };
}

/* ------------------------------------------------------------------ wording */

export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "amount not set";
  return `${currency || ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
}

/** One line for the feed, the deal note and the notification. */
export function describeUpdate(u: {
  type: DealUpdateType;
  payment: DealUpdatePayment | null;
  channel: DealUpdateChannel;
  note: string;
  po?: string | null;
}): string {
  const via = u.channel === "other" ? "" : ` (via ${CHANNEL_LABEL[u.channel]})`;
  if (u.type === "payment" && u.payment) {
    const p = u.payment;
    const who = p.side === "buyer" ? "" : ` · ${SIDE_LABEL[p.side].toLowerCase()}`;
    const po = u.po ? ` for PO ${u.po}` : "";
    return `${PAYMENT_KIND_LABEL[p.kind]} ${formatMoney(p.amount, p.currency)}${who}${po} on ${p.date}${via}`;
  }
  const note = u.note.length > 160 ? `${u.note.slice(0, 159)}…` : u.note;
  return `${note}${via}`;
}
