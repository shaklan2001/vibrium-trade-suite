/**
 * Bank statements from any bank, as an uploaded file: PDF (text layer), Excel, CSV or HTML.
 *
 *   Finacle HTML           the existing parser (parseFinacleStatement)
 *   Tables (Excel / CSV)   a header row names the columns: date, narration, debit, credit, balance
 *   Text (PDF)             every line that starts with a date is a transaction; wrapped narration
 *                          lines are joined to it; debit or credit comes from a CR/DR mark, the
 *                          change in the running balance, or the wording
 *
 * Lines it cannot place are counted, never guessed. Pure; no I/O. Salary, loan, tax and card lines
 * are classified here and dropped later by isTradeLine (nothing personal is stored).
 */
import { classifyBankLine, parseFinacleStatement, referenceOf, type BankLine } from "./bankStatement";

export type ParsedStatement = {
  lines: BankLine[];
  currency: string;
  account: string;
  method: "finacle_html" | "table" | "text" | "advice" | "none";
  /** Date-looking lines whose amount or direction could not be worked out. */
  skipped: number;
};

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const pad = (n: number | string) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** 03 Nov 2026, 03-Nov-26, 3/11/2026, 03.11.2026, 2026-11-03, Nov 3 2026, and "03 Nov" with a fallback year. */
export function parseLooseDate(raw: string, fallbackYear?: number): string | null {
  const s = raw.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return validDay(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/.exec(s);
  if (m) return validDay(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[-/. ]([A-Za-z]{3,9})\.?(?:[-/. ](\d{2,4}))?$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : fallbackYear;
    return mon && y ? validDay(y, +mon, +m[1]!) : null;
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}) (\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    return mon ? validDay(+m[3]!, +mon, +m[2]!) : null;
  }
  return null;
}

const AMOUNT = /(?<![\w.,])\(?-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}\)?(?:\s?(?:CR|DR|Cr|Dr))?(?![\w])/g;

type Amt = { value: number; dir: "cr" | "dr" | null; text: string };

function amountsIn(line: string): Amt[] {
  const out: Amt[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const t = m[0];
    const dir = /CR$/i.test(t) ? "cr" : /DR$/i.test(t) ? "dr" : null;
    const neg = /^\(|^-/.test(t);
    const n = Number(t.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push({ value: neg ? -n : n, dir: dir ?? (neg ? "dr" : null), text: t });
  }
  return out;
}

const CREDIT_WORDS = /\b(credit|deposit|inward|received|receipt|remittance|refund|interest paid|cr\b)/i;
const DEBIT_WORDS = /\b(debit|withdraw|payment to|paid to|charge|fee|outward|transfer to|purchase|dr\b)/i;

/** Currency of the account: "Currency: USD", else the first currency code near the top, else INR. */
export function detectCurrency(text: string): string {
  const head = text.slice(0, 2500);
  const labelled = /\b(?:account\s+)?(?:currency|ccy)\b[\s:|]*([A-Z]{3})\b/i.exec(head)?.[1]?.toUpperCase();
  if (labelled && /^(INR|USD|EUR|GBP|HKD|AED|SGD|CNY|JPY|AUD|CAD)$/.test(labelled)) return labelled;
  const code = /\b(INR|USD|EUR|GBP|HKD|AED|SGD|CNY|AUD)\b/.exec(head)?.[1];
  if (code) return code;
  return "INR";
}

function detectAccount(text: string): string {
  const m = /(?:account\s*(?:no\.?|number)|a\/c(?:\s*no\.?)?)[\s:|#]*([0-9][0-9\-*xX ]{5,24})/i.exec(text.slice(0, 3000));
  const digits = (m?.[1] || "").replace(/[^0-9*xX]/g, "");
  // Only the tail is kept: the number is a label for the line id, not data we show.
  return digits ? `…${digits.slice(-4)}` : "uploaded";
}

function detectYear(text: string): number | undefined {
  const head = text.slice(0, 3000);
  const labelled = /(?:statement|period|from|as at|date)[^\n]{0,60}\b(20\d{2})\b/i.exec(head)?.[1];
  const any = /\b(20\d{2})\b/.exec(head)?.[1];
  const y = Number(labelled || any);
  return Number.isFinite(y) ? y : undefined;
}

function toLine(
  row: { date: string; particulars: string; debit: number; credit: number; balance: number | null },
  account: string,
  currency: string,
): BankLine {
  const particulars = row.particulars.replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    account,
    date: row.date,
    valueDate: null,
    cheque: null,
    particulars,
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
    kind: classifyBankLine(particulars, row.debit, row.credit),
    reference: referenceOf(particulars),
    currency,
  };
}

const NOISE =
  /^\s*(page\s+\d+|continued|statement of account|account statement|balance (?:brought|carried) forward|b\/f|c\/f|opening balance|closing balance|total\b|date\s+(?:description|narration|particulars|details)|transaction date)/i;

const DATE_START = /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3,9})\.?(?:[-/. ,]+\d{2,4})?)(?=\s)/;

/** PDF text: a transaction per line that starts with a date. */
export function parseStatementText(text: string): ParsedStatement {
  const currency = detectCurrency(text);
  const account = detectAccount(text);
  const year = detectYear(text);
  type Row = { date: string; first: string; cont: string[] };
  const rows: Row[] = [];
  let cur: Row | null = null;
  // "Balance brought forward 50,000.00" before the first transaction: the start of the running balance.
  let opening: number | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\t/g, " ");
    if (!line.trim()) continue;
    const dm = DATE_START.exec(line);
    const date = dm ? parseLooseDate(dm[1]!, year) : null;
    const rest = dm ? line.slice(dm[0].length).trim() : line;
    if ((dm && date && NOISE.test(rest)) || (!dm && /^\s*(balance (?:brought forward|b\/f)|opening balance|b\/f)/i.test(line))) {
      cur = null;
      const a = amountsIn(dm && date ? rest : line);
      if (!rows.length && a.length) opening = a[a.length - 1]!.value;
    } else if (dm && date && !NOISE.test(line)) {
      cur = { date, first: rest, cont: [] };
      rows.push(cur);
    } else if (cur && !NOISE.test(line)) {
      cur.cont.push(line.trim());
    }
  }
  // Newest-first statements: put them oldest-first so the running balance can be followed.
  if (rows.length > 1 && rows[0]!.date > rows[rows.length - 1]!.date) {
    rows.reverse();
    opening = null;
  }

  const lines: BankLine[] = [];
  let skipped = 0;
  let prev: number | null = opening;
  for (const r of rows) {
    let amts = amountsIn(r.first);
    let desc = r.first;
    if (!amts.length) {
      const hit = r.cont.find((c) => amountsIn(c).length);
      if (hit) {
        amts = amountsIn(hit);
        desc = `${r.first} ${hit}`;
      }
    }
    const particulars = [r.first, ...r.cont].map((c) => c.replace(AMOUNT, " ")).join(" ").replace(/\s+/g, " ").trim();
    if (!amts.length) {
      skipped += 1;
      continue;
    }
    // Two or three amounts: the last is the balance; the one before it (or the non-zero one of two) is the transaction.
    let balance: number | null = null;
    let txn: Amt | null = null;
    if (amts.length >= 2) {
      balance = amts[amts.length - 1]!.value;
      const cands = amts.slice(0, -1);
      txn = cands.find((a) => a.value !== 0) ?? cands[0]!;
    } else {
      txn = amts[0]!;
    }
    const value = Math.abs(txn.value);
    let dir: "cr" | "dr" | null = txn.dir;
    if (!dir && balance != null && prev != null) {
      if (Math.abs(balance - prev - value) <= 0.05 + value * 0.0001) dir = "cr";
      else if (Math.abs(prev - balance - value) <= 0.05 + value * 0.0001) dir = "dr";
    }
    if (!dir) {
      const w = `${desc} ${particulars}`;
      if (CREDIT_WORDS.test(w) && !DEBIT_WORDS.test(w)) dir = "cr";
      else if (DEBIT_WORDS.test(w) && !CREDIT_WORDS.test(w)) dir = "dr";
    }
    if (balance != null) prev = balance;
    if (!dir || value === 0) {
      skipped += 1;
      continue;
    }
    lines.push(toLine({ date: r.date, particulars, debit: dir === "dr" ? value : 0, credit: dir === "cr" ? value : 0, balance }, account, currency));
  }
  return { lines, currency, account, method: lines.length ? "text" : "none", skipped };
}

const HEADER = {
  date: /^(?:txn |tran(?:saction)? |posting |booking )?date$|^date$/i,
  desc: /narration|description|particulars|details|remarks|transaction/i,
  debit: /debit|withdraw|paid out|money out|^dr$/i,
  credit: /credit|deposit|paid in|money in|^cr$/i,
  balance: /balance/i,
  amount: /^amount$/i,
  type: /^(?:dr\/cr|cr\/dr|type)$/i,
};

/** Excel / CSV rows (cells joined with " | "): the header row names the columns. */
export function parseStatementTable(text: string): ParsedStatement {
  const currency = detectCurrency(text);
  const account = detectAccount(text);
  const year = detectYear(text);
  const grid = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.includes(" | "))
    .map((l) => l.split(" | ").map((c) => c.trim()));
  const hi = grid.findIndex((cells) => {
    const hits = [HEADER.date, HEADER.desc, HEADER.debit, HEADER.credit, HEADER.balance, HEADER.amount].filter((re) => cells.some((c) => re.test(c))).length;
    return hits >= 3;
  });
  if (hi < 0) return { lines: [], currency, account, method: "none", skipped: 0 };
  const head = grid[hi]!;
  const col = (re: RegExp, skip: RegExp | null = null) => head.findIndex((c) => re.test(c) && !(skip && skip.test(c)));
  const cDate = col(HEADER.date, /value/i);
  const cDesc = col(HEADER.desc, /date/i);
  const cDr = col(HEADER.debit);
  const cCr = col(HEADER.credit);
  const cBal = col(HEADER.balance);
  const cAmt = col(HEADER.amount);
  const cType = col(HEADER.type);
  const num = (s: string | undefined) => {
    const a = amountsIn((s || "").trim());
    if (a.length) return a[0]!;
    const n = Number((s || "").replace(/[^\d.-]/g, ""));
    return s && Number.isFinite(n) && /\d/.test(s) ? ({ value: n, dir: null, text: s } as Amt) : null;
  };
  const lines: BankLine[] = [];
  let skipped = 0;
  for (const cells of grid.slice(hi + 1)) {
    const date = parseLooseDate(cells[cDate] || "", year);
    if (!date) continue;
    let debit = 0;
    let credit = 0;
    if (cDr >= 0 || cCr >= 0) {
      debit = Math.abs(num(cells[cDr])?.value || 0);
      credit = Math.abs(num(cells[cCr])?.value || 0);
    } else if (cAmt >= 0) {
      const a = num(cells[cAmt]);
      const t = (cells[cType] || "").toUpperCase();
      if (a) {
        const isDr = a.dir === "dr" || a.value < 0 || /^D/.test(t);
        if (isDr) debit = Math.abs(a.value);
        else credit = Math.abs(a.value);
      }
    }
    if (!debit && !credit) {
      skipped += 1;
      continue;
    }
    const balance = cBal >= 0 ? (num(cells[cBal])?.value ?? null) : null;
    lines.push(toLine({ date, particulars: cells[cDesc] || cells.join(" "), debit, credit, balance }, account, currency));
  }
  return { lines, currency, account, method: lines.length ? "table" : "none", skipped };
}

const ADVICE_HEAD = /\b(credit|debit)\s+advice\b/i;
// No \b before the code: OCR of a scanned advice can glue a stray letter to it ("uUSD8.30").
const ADVICE_MONEY = /(?<![A-Z])([A-Z]{3})\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d,])/;
const ADVICE_DATE = /(\d{4}-\d{2}-\d{2}|\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3,9})\.?[-/. ]\d{2,4})/;
/** The labels of a credit / debit advice; a line that starts with one ends the block above it. */
const ADVICE_LABEL = /^\s*(?:payer bank|payment details|by order of|bank to bank information|beneficiary(?: bank)?|notes|remitting bank|ordering customer|this is a computer)\b/i;

/** "Payment amount: USD10,970.00 Local charges: HKD65.00" → { currency: "USD", value: 10970 } */
function adviceMoney(seg: string, label: RegExp): { currency: string; value: number } | null {
  const at = label.exec(seg);
  if (!at) return null;
  const m = ADVICE_MONEY.exec(seg.slice(at.index + at[0].length, at.index + at[0].length + 40));
  if (!m) return null;
  const value = Number(m[2]!.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? { currency: m[1]!, value } : null;
}

/** The lines under a label line (two-column layouts put both labels on one line and the values below). */
function linesUnder(lines: string[], label: RegExp): string[] {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  const sameLine = lines[i]!.replace(label, "").replace(/^[\s:]+/, "").trim();
  if (sameLine && !/:\s*$/.test(lines[i]!) && !ADVICE_LABEL.test(sameLine)) out.push(sameLine);
  for (const l of lines.slice(i + 1)) {
    if (ADVICE_LABEL.test(l) || /^\s*page\s*:?\s*\d/i.test(l)) break;
    if (l.trim()) out.push(l.trim());
  }
  return out;
}

/**
 * A bank credit / debit advice (HSBC "Credit Advice", "Debit Advice"): one transaction per advice,
 * written as labelled fields rather than a table. A file may hold several advices; each becomes a line.
 */
export function parseBankAdvice(text: string): ParsedStatement {
  const empty: ParsedStatement = { lines: [], currency: "INR", account: "uploaded", method: "none", skipped: 0 };
  if (!ADVICE_HEAD.test(text)) return empty;
  const starts = [...text.matchAll(new RegExp(ADVICE_HEAD.source, "gi"))].map((m) => m.index!);
  const segments = starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length));
  const seen = new Set<string>();
  const lines: BankLine[] = [];
  let skipped = 0;
  for (const seg of segments) {
    const dir = /^debit/i.test(ADVICE_HEAD.exec(seg)![1]!) ? "dr" : "cr";
    const net = adviceMoney(seg, dir === "cr" ? /amount credited\s*:/i : /amount debited\s*:/i);
    const gross = adviceMoney(seg, /(?:payment|transaction|remittance) amount\s*:/i);
    const amt = net ?? gross;
    // OCR can miss the charges field on a scan: gross minus credited is the same number.
    const charges =
      adviceMoney(seg, /total charges\s*:/i) ??
      (gross && net && gross.currency === net.currency && gross.value > net.value ? { currency: net.currency, value: Math.round((gross.value - net.value) * 100) / 100 } : null);
    const dateRaw = /(?:transaction|value) date\s*:\s*([^\n]*)/i.exec(seg)?.[1] ?? "";
    const date = parseLooseDate(ADVICE_DATE.exec(dateRaw)?.[1] ?? "");
    const reference = /(?:transaction|our|bank) reference(?:\s*(?:no\.?|number))?\s*:\s*([A-Z0-9][A-Z0-9/-]{5,})/i.exec(seg)?.[1]?.toUpperCase() ?? null;
    if (!amt || !date) {
      // A heading with no amount / date is the advice's second page or a mention in prose.
      if (amt || date) skipped += 1;
      continue;
    }
    if (reference && seen.has(reference)) continue;
    if (reference) seen.add(reference);

    const rows = seg.replace(/\r/g, "").split("\n");
    const acct = /(?:credited|debited|your) account(?:\s*(?:no\.?|number))?\s*:\s*([0-9][0-9\- ]{5,24})/i.exec(seg)?.[1]?.replace(/\D/g, "") ?? "";
    const account = acct ? `…${acct.slice(-4)}` : "uploaded";
    const party = linesUnder(rows, dir === "cr" ? /^\s*(?:by order of|ordering customer)\s*:?/i : /^\s*beneficiary\s*:?/i)[0] ?? "";
    const bankBlock = linesUnder(rows, /^\s*(?:payer bank|remitting bank|beneficiary bank)\s*:?/i);
    // SWIFT field 70 lines start with "/" and wrap at a fixed width, often mid-word: join them unspaced.
    const firstDetail = bankBlock.findIndex((l) => l.startsWith("/"));
    const bank = (firstDetail < 0 ? bankBlock : bankBlock.slice(0, firstDetail)).join(" ");
    const details = firstDetail < 0 ? "" : bankBlock.slice(firstDetail).join("");
    const fmt = (m: { currency: string; value: number }) => `${m.currency} ${m.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const particulars = [
      dir === "cr" ? "INWARD TT" : "OUTWARD TT",
      party ? `${dir === "cr" ? "FROM" : "TO"} ${party}` : "",
      bank ? `VIA ${bank}` : "",
      details,
      reference ? `REF ${reference}` : "",
      gross && net && gross.value !== net.value ? `GROSS ${fmt(gross)}` : "",
      charges ? `LESS COSTS ${fmt(charges)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push({
      ...toLine({ date, particulars, debit: dir === "dr" ? amt.value : 0, credit: dir === "cr" ? amt.value : 0, balance: null }, account, amt.currency),
      reference: reference ?? referenceOf(particulars),
    });
  }
  return { lines, currency: lines[0]?.currency ?? "INR", account: lines[0]?.account ?? "uploaded", method: lines.length ? "advice" : "none", skipped };
}

const COLLECTION_HEAD = /\bexport collection payment advice\b/i;

/**
 * An HSBC "Export Collection Payment Advice": the buyer (drawee) paid a documentary collection.
 * Collection amount = what the buyer paid; Final Total = what reached the account after the
 * collecting bank's and HSBC's fees. "Your Reference No." carries our invoice numbers.
 */
export function parseExportCollection(text: string): ParsedStatement {
  const empty: ParsedStatement = { lines: [], currency: "INR", account: "uploaded", method: "none", skipped: 0 };
  if (!COLLECTION_HEAD.test(text)) return empty;
  const field = (label: RegExp) => label.exec(text)?.[1]?.trim() ?? "";
  const gross = adviceMoney(text, /collection amount\s*:/i);
  const proceeds = adviceMoney(text, /proceeds? received\s*:/i);
  const final = /final total[^\n]*?(?<![A-Z])([A-Z]{3})\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*CR\b/i.exec(text);
  const net = final ? { currency: final[1]!, value: Number(final[2]!.replace(/,/g, "")) } : proceeds ?? gross;
  const valueDate = /value\s+([A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}[-/. ][A-Za-z]{3,9}[-/. ]\d{2,4})/i.exec(text)?.[1];
  const date = parseLooseDate(valueDate ?? "") ?? parseLooseDate(/^\s*([A-Za-z]{3,9} \d{1,2},? \d{4})\s*$/m.exec(text)?.[1] ?? "");
  if (!net || !date) return { ...empty, skipped: 1 };
  const reference = field(/our reference no\.?\s*:\s*([A-Z0-9-]{6,})/i).toUpperCase() || null;
  const drawee = field(/drawee\s*:\s*([^\n]+)/i);
  const invoices = field(/your reference no\.?\s*:\s*([^\n]+)/i);
  const fmt = (m: { currency: string; value: number }) => `${m.currency} ${m.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const costs = gross && gross.currency === net.currency && gross.value > net.value ? { currency: net.currency, value: Math.round((gross.value - net.value) * 100) / 100 } : null;
  const particulars = [
    "INWARD EXPORT COLLECTION",
    drawee ? `FROM ${drawee}` : "",
    "VIA HSBC",
    invoices ? `INV ${invoices}` : "",
    reference ? `REF ${reference}` : "",
    gross && gross.value !== net.value ? `GROSS ${fmt(gross)}` : "",
    costs ? `LESS COSTS ${fmt(costs)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const acct = /credited your account number\s*[*xX]*(\d{3,})/i.exec(text)?.[1] ?? "";
  const account = acct ? `…${acct.slice(-4)}` : "uploaded";
  const line: BankLine = { ...toLine({ date, particulars, debit: 0, credit: net.value, balance: null }, account, net.currency), reference: reference ?? referenceOf(particulars) };
  return { lines: [line], currency: net.currency, account, method: "advice", skipped: 0 };
}

/** Any uploaded statement. `html` is the raw file when it is an HTML e-statement; `text` is its extracted text. */
export function parseStatement(input: { html?: string; text: string }): ParsedStatement {
  if (input.html) {
    const fin = parseFinacleStatement(input.html);
    if (fin.length) return { lines: fin, currency: "INR", account: fin[0]!.account, method: "finacle_html", skipped: 0 };
  }
  // Labelled advice fields ("Transaction reference:", "Amount credited:") never appear in a statement table.
  const advice = parseBankAdvice(input.text);
  if (advice.lines.length) return advice;
  const collection = parseExportCollection(input.text);
  if (collection.lines.length) return collection;
  const table = parseStatementTable(input.text);
  if (table.lines.length) return table;
  const text = parseStatementText(input.text);
  return text.lines.length ? text : { ...text, skipped: text.skipped + table.skipped };
}
