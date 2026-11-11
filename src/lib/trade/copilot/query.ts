/**
 * Understand a Copilot question deterministically before any LLM call:
 * which deals it names (PO / deal code / booking / container), which filters
 * it implies (stage, overdue, missing docs, book), and what kind of answer
 * it wants (one deal, a list, a count, attention, product how-to, follow-up).
 */
import {
  bookingNumberIn,
  cleanPoNumber,
  containerNumberIn,
  poNumbersIn,
} from "@/lib/trade/dealReference";
import type { DealStage } from "@/types/trade";

export type CopilotIntent =
  | "deal" // about specific deal(s)
  | "list" // a filtered set of deals
  | "count" // how many / how much
  | "attention" // what needs attention / priorities / todos
  | "product" // how to use the platform
  | "overview"; // general book question

export type CopilotQuery = {
  text: string;
  intent: CopilotIntent;
  poNumbers: string[];
  dealCodes: string[];
  bookingNumbers: string[];
  containerNumbers: string[];
  stages: DealStage[];
  model?: "agency_commission" | "trader_principal";
  overdue: boolean;
  docsMissing: boolean;
  payment: boolean;
  shipping: boolean;
  /** Refers back to the previous answer ("its", "this deal", "those"). */
  followUp: boolean;
  /** Mentions the deal on screen ("this deal", "this PO"). */
  thisDeal: boolean;
  /**
   * Clearly points back at the previous answer ("this thread", "those deals",
   * "it", "them") — wins over other words in the question. Bare "that"/"this"
   * don't count ("deals that are overdue").
   */
  refersBack: boolean;
  /** Free words left after removing filler — party / teammate / product names. */
  terms: string[];
};

const STOPWORDS = new Set(
  (
    "a an the and or but of to in on at for from by with about into over under " +
    "is are was were be been being am do does did done have has had having " +
    "i me my we our us you your he she it its they them their this that these those " +
    "what which who whom whose when where why how whats hows " +
    "can could would should will shall may might must " +
    "please pls kindly tell show give list get find fetch pull open display share send " +
    "summarize summarise summary summaries brief briefly explain describe detail details " +
    "status update updates latest current currently recent recently now today yesterday tomorrow " +
    "all any some every each many much more most less few total count number numbers " +
    "deal deals order orders po pos p.o purchase book business mailbox copilot savvy " +
    "stage stages pipeline open closed active pending overdue due late payment payments paid " +
    "doc docs document documents missing pending shipment shipments shipping sail sailing " +
    "eta etd vessel arrive arrival arrived booking bookings container containers " +
    "need needs needed want like know see look check also just only still yet " +
    "there here than then so very really not no yes ok okay hi hello hey thanks thank " +
    "one two three week weeks month months year years day days time " +
    "value amount amounts money usd inr cash term terms next step steps " +
    "agency trader buyer buyers factory factories supplier suppliers forwarder forwarders party parties " +
    "connect connected connection add new create delete remove edit change set setup use using upload export import " +
    "refresh sync email emails inbox login sign password settings page screen tab button report dashboard feature work works"
  ).split(/\s+/),
);

const STAGE_PATTERNS: [RegExp, DealStage][] = [
  [/\brequirements?\b|\benquir(?:y|ies)\b|\binquir(?:y|ies)\b/i, "requirement"],
  [/\boutreach\b/i, "outreach"],
  [/\bquot(?:e|es|ing|ation|ations)\b/i, "quoting"],
  [/\bselection\b/i, "selection"],
  [/\bartworks?\b/i, "artwork"],
  [/\bsamples?\b|\bsampling\b/i, "samples"],
  [/\bpi\s*(?:\/|and|&)?\s*po\b|\bproforma\b/i, "pi_po"],
  [/\bpackaging\b/i, "packaging"],
  [/\bproduction\b|\binspections?\b/i, "production"],
  [/\bbooking stage\b|\bin booking\b|\bbooking deals?\b|\bdeals? in booking\b|\bbooked\b/i, "booking"],
  [/\bdocs?\s*(?:&|and)\s*payments?\b/i, "docs_payment"],
  [/\bclosed\b/i, "closed"],
];

const DEAL_CODE_RE = /\b(?:PO|BKG|CNTR)-[A-Z0-9][A-Z0-9-]{2,30}\b|\bMB-[A-Z0-9]+(?:-[A-Z0-9]+){0,3}\b/gi;
/** Bare PO-like tokens: 14837, S14747, 14684B, G2625146. Years are excluded. */
const BARE_PO_RE = /(?<![\w$.,/-])([A-Z]{0,2}\d{4,10}[A-Z]{0,2})(?![\w%])/gi;

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function isYear(token: string): boolean {
  return /^(19|20)\d{2}$/.test(token);
}

export function parseCopilotQuery(raw: string): CopilotQuery {
  const text = raw.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  const dealCodes = uniq((text.match(DEAL_CODE_RE) || []).map((c) => c.toUpperCase()));

  const poNumbers: string[] = [];
  const addPo = (p: string | null | undefined) => {
    const c = cleanPoNumber(p);
    if (c && !isYear(c) && !poNumbers.includes(c)) poNumbers.push(c);
  };
  for (const p of poNumbersIn(text)) addPo(p);
  for (const code of dealCodes) {
    if (code.startsWith("PO-")) addPo(code.slice(3));
  }
  // Bare numbers ("summarize 15269") — skip money and dates.
  const moneyOrDate = /(?:[$₹€£]|\busd|\binr|rs\.?)\s*$/i;
  for (const m of text.matchAll(BARE_PO_RE)) {
    const before = text.slice(Math.max(0, m.index! - 5), m.index!);
    if (moneyOrDate.test(before)) continue;
    if (/^\d{4}$/.test(m[1]) && isYear(m[1])) continue;
    addPo(m[1]);
  }

  const bookingNumbers = uniq([bookingNumberIn(text)].filter((x): x is string => Boolean(x)));
  const containerNumbers = uniq(
    [containerNumberIn(text)].filter((x): x is string => Boolean(x)).map((x) => x.toUpperCase()),
  );
  // A container number also matches the bare-PO pattern ("MSNU9007006"); drop it there.
  const containerish = new Set(containerNumbers);
  const pos = poNumbers.filter((p) => !containerish.has(p) && !bookingNumbers.includes(p));

  const stages = uniq(
    STAGE_PATTERNS.filter(([re]) => re.test(text)).map(([, stage]) => stage),
  ).filter((s) => !(s === "booking" && bookingNumbers.length));

  let model: CopilotQuery["model"];
  if (/\btrader\b|\btrading book\b|\bprincipal\b/i.test(text)) model = "trader_principal";
  else if (/\bagency book\b|\bagency deals?\b|\bcommission book\b/i.test(text)) {
    model = "agency_commission";
  }

  const overdue = /\boverdue\b|\bpast due\b|\blate payments?\b|\bnot (?:yet )?(?:been )?paid\b|\bdelayed payments?\b/i.test(text);
  const docsMissing =
    /\bmissing (?:docs?|documents?)\b|\b(?:docs?|documents?) (?:are )?(?:missing|pending|outstanding)\b|\bpending (?:docs?|documents?)\b/i.test(
      text,
    );
  const payment = overdue || /\bpayments?\b|\bpaid\b|\breceivables?\b|\bcollect(?:ion|ed)?\b|\bcash\b|\binvoice\b/i.test(text);
  const shipping = /\bsail(?:s|ed|ing)?\b|\betd\b|\beta\b|\bvessel\b|\barriv(?:e|al|ed|ing)\b|\bshipments?\b|\bin transit\b|\bcontainer\b/i.test(
    text,
  );
  const thisDeal = /\bthis (?:deal|po|order|shipment|thread)\b|\bcurrent deal\b|\bon (?:this|the) page\b/i.test(text);
  const followUp =
    thisDeal ||
    /\b(?:it|its|it's|that|this|them|those|these|same|they|their)\b/i.test(lower) &&
      !dealCodes.length &&
      !pos.length;

  const refersBack =
    !dealCodes.length &&
    !pos.length &&
    (/\b(?:this|that|these|those|the same)\s+(?:deals?|pos?|orders?|shipments?|threads?|ones?|containers?|bookings?|customers?|buyers?|factor(?:y|ies))\b/i.test(text) ||
      /\b(?:it|its|it's|them|they|their|those|these)\b/i.test(text));

  const terms = uniq(
    lower
      .replace(DEAL_CODE_RE, " ")
      .split(/[^a-z0-9@._&'-]+/)
      .map((t) => t.replace(/^['.-]+|['.-]+$/g, "").replace(/'s$/, ""))
      .filter(
        (t) =>
          t.length >= 3 &&
          t.length <= 40 &&
          !STOPWORDS.has(t) &&
          !/^\d+$/.test(t) &&
          !pos.some((p) => p.toLowerCase() === t),
      ),
  ).slice(0, 6);

  const counting = /\bhow many\b|\bhow much\b|\bcount\b|\bnumber of\b|\btotal\b|\bsum\b/i.test(text);
  const attentionAsk =
    /\battention\b|\burgent\b|\bpriorit(?:y|ies|ise|ize)\b|\bat risk\b|\brisks?\b|\bto-?dos?\b|\bfocus\b|\bblock(?:ed|ers?)\b|\bwhat should i\b|\bmorning brief\b|\bdaily brief\b/i.test(
      text,
    );
  const productAsk =
    /\bhow (?:do|can|should) i\b|\bwhere (?:do|can) i\b|\bhow to\b|\bwhat is this (?:platform|app|tool)\b|\bwhich (?:page|screen|tab)\b|\bwhat can you do\b|\bhelp me use\b/i.test(
      text,
    );

  const named = pos.length + dealCodes.length + bookingNumbers.length + containerNumbers.length;
  let intent: CopilotIntent;
  if (named > 0) intent = "deal";
  else if (counting) intent = "count";
  else if (attentionAsk) intent = "attention";
  else if (productAsk) intent = "product";
  else if (stages.length || overdue || docsMissing || model || terms.length) intent = "list";
  else if (followUp) intent = "deal";
  else intent = "overview";

  return {
    text,
    intent,
    poNumbers: pos,
    dealCodes,
    bookingNumbers,
    containerNumbers,
    stages,
    model,
    overdue,
    docsMissing,
    payment,
    shipping,
    followUp,
    thisDeal,
    refersBack,
    terms,
  };
}
