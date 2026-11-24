/**
 * One place for how figures are written: containers, CBM, dates, invoice numbers.
 * The same rules the evaluation uses (scripts/eval-mail-criteria.ts), so a figure that only
 * differs in format is never reported as a mismatch. Client-safe and pure.
 */

/** Container number without spaces or dashes, upper case: "msku 123456-7" → "MSKU1234567". */
export function normContainer(raw: string | null | undefined): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const LETTER_VALUES: Record<string, number> = {};
{
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v += 1;
    LETTER_VALUES[ch] = v;
    v += 1;
  }
}

/** ISO 6346 check digit: four letters, six digits, one check digit. */
export function isValidContainer(raw: string | null | undefined): boolean {
  const c = normContainer(raw);
  if (!/^[A-Z]{4}\d{7}$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = c[i]!;
    const value = i < 4 ? LETTER_VALUES[ch]! : Number(ch);
    sum += value * 2 ** i;
  }
  return (sum % 11) % 10 === Number(c[10]);
}

/** Volume in cubic metres, three decimals; null when it is not a number. */
export function normCbm(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

/** Same figure within rounding: 29.7 and 29.705 are one number. */
export function sameNumber(a: number, b: number, tolerance = 0.0005): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= Math.max(0.01, scale * tolerance);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * One calendar day as YYYY-MM-DD from the formats in the mails:
 * 2026-11-13, 13/11/2026, 13-11-26, 13 Nov 2026, Nov 13, 2026. Day first for numeric dates.
 */
export function normDate(raw: string | null | undefined, fallbackYear = new Date().getUTCFullYear()): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!) ? iso(+m[1]!, +m[2]!, +m[3]!) : null;
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(text);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return valid(year, +m[2]!, +m[1]!) ? iso(year, +m[2]!, +m[1]!) : null;
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*[\s,-]*(\d{2,4})?$/i.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : fallbackYear;
    return month && valid(year, month, +m[1]!) ? iso(year, month, +m[1]!) : null;
  }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{2,4})?$/i.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : fallbackYear;
    return month && valid(year, month, +m[2]!) ? iso(year, month, +m[2]!) : null;
  }
  return null;
}

export type DateWindow = { from: string; to: string };

/**
 * "end of December", "mid Nov", "first week of March" → a window. Null when the text names no month.
 */
export function vagueDateWindow(raw: string | null | undefined, year = new Date().getUTCFullYear()): DateWindow | null {
  const text = (raw || "").toLowerCase();
  const found = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(text);
  if (!found) return null;
  const month = MONTHS.indexOf(found[1]!) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (/\b(end|last week|late)\b/.test(text)) return { from: iso(year, month, Math.max(1, last - 10)), to: iso(year, month, last) };
  if (/\b(mid|middle)\b/.test(text)) return { from: iso(year, month, 10), to: iso(year, month, 20) };
  if (/\b(start|begin|early|first week)\b/.test(text)) return { from: iso(year, month, 1), to: iso(year, month, 10) };
  return { from: iso(year, month, 1), to: iso(year, month, last) };
}

/**
 * Invoice number as one key: "GP/25-26/040", "gp 25-26 040" and "GP/25-2/040" (a common typo
 * for the financial year) all become "GP/25-26/040" → "GP2526040".
 */
export function normInvoiceNo(raw: string | null | undefined): string {
  const text = (raw || "").toUpperCase().replace(/\s+/g, "");
  // Financial year typo: 25-2 for 25-26.
  const fixed = text.replace(/(\d{2})-(\d)(?=[/\-]|$)/g, (whole, a: string, b: string) => {
    const next = String(Number(a) + 1).padStart(2, "0");
    return next.startsWith(b) ? `${a}-${next}` : whole;
  });
  return fixed.replace(/[^A-Z0-9]/g, "");
}
