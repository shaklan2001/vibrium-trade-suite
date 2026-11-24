/**
 * Check an extracted PI / PO / invoice against the text of the file it came from.
 *
 * Every figure the reader returned (total, CBM, document number, ready date, and each line's
 * quantity, price, amount and item code) must be findable in the file text, in any common way
 * of writing it. Figures that are not found are listed, so the deal page can mark them and
 * Copilot can say "(unverified)". Pure; used by finalizeDealDocuments and the evaluation.
 */
import { normDate, sameNumber } from "./normalize";

export type Verification = {
  checked: number;
  verified: number;
  /** Paths such as "totalAmount" or "lines[2].unitPrice". */
  unverified: string[];
};

/** Every number written in the text, with thousands separators and trailing zeros removed. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function hasNumber(numbers: number[], value: number): boolean {
  return numbers.some((n) => sameNumber(n, value));
}

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function hasCode(text: string, code: string): boolean {
  const c = compact(code);
  return c.length >= 2 && compact(text).includes(c);
}

function hasDate(text: string, raw: string): boolean {
  const want = normDate(raw);
  if (!want) return text.toLowerCase().includes(raw.toLowerCase());
  const year = Number(want.slice(0, 4));
  // Read each date-looking token in the text and compare days.
  const M = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
  const re = new RegExp(`\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?[ \\t-]+${M}[ \\t,.-]*\\d{2,4}|${M}\\.?[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]*\\d{2,4}`, "gi");
  const tokens = text.match(re) || [];
  return tokens.some((t) => normDate(t.trim(), year) === want);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function verifyExtract(result: Record<string, unknown> | null | undefined, text: string): Verification {
  const out: Verification = { checked: 0, verified: 0, unverified: [] };
  if (!result || !text.trim()) return out;
  const numbers = numbersIn(text);
  const check = (path: string, ok: boolean) => {
    out.checked += 1;
    if (ok) out.verified += 1;
    else out.unverified.push(path);
  };
  for (const key of ["totalAmount", "totalCbm"] as const) {
    const v = num(result[key]);
    if (v != null && v > 0) check(key, hasNumber(numbers, v));
  }
  const docNumber = str(result.docNumber);
  if (docNumber) check("docNumber", hasCode(text, docNumber));
  const ready = str(result.readyDate);
  if (ready) check("readyDate", hasDate(text, ready));
  const lines = Array.isArray(result.lines) ? (result.lines as Record<string, unknown>[]) : [];
  lines.slice(0, 60).forEach((line, i) => {
    for (const key of ["qty", "unitPrice", "amount", "cbm"] as const) {
      const v = num(line?.[key]);
      if (v != null && v > 0) check(`lines[${i}].${key}`, hasNumber(numbers, v));
    }
    const code = str(line?.itemCode);
    if (code) check(`lines[${i}].itemCode`, hasCode(text, code));
  });
  return out;
}

/** Share of checked figures found in the file (1 when nothing was checked). */
export function verifiedShare(v: Verification | null | undefined): number {
  return v && v.checked ? v.verified / v.checked : 1;
}
