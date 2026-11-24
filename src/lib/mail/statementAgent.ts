/**
 * Bank statement reader agent: for layouts the built-in parser cannot place (an unusual PDF), the
 * statement's text goes to a Vibrium worker agent that returns the transactions as JSON.
 * Provision it with scripts/provision-statement-reader.mjs and set VIBRIUM_STATEMENT_READER_AGENT_ID.
 * Server only; fails soft (returns null).
 */
import { classifyBankLine, referenceOf, type BankLine } from "./bankStatement";
import { parseLooseDate } from "./statementParse";
import { executionResult, getExecution, startExecution, TERMINAL } from "./workers";

export const STATEMENT_TEXT_LIMIT = 30_000;

export function statementAgentId() {
  return process.env.VIBRIUM_STATEMENT_READER_AGENT_ID || "";
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : 0;
};

/** The agent's JSON → statement lines. Rows without a valid date or an amount are dropped. */
export function linesFromAgent(result: Record<string, unknown> | null): { lines: BankLine[]; currency: string } | null {
  if (!result) return null;
  const rows = Array.isArray(result.transactions) ? (result.transactions as Record<string, unknown>[]) : null;
  if (!rows) return null;
  const currency = typeof result.currency === "string" && /^[A-Z]{3}$/.test(result.currency) ? result.currency : "INR";
  const account = typeof result.account_last4 === "string" && result.account_last4 ? `…${result.account_last4.slice(-4)}` : "uploaded";
  const lines: BankLine[] = [];
  for (const r of rows) {
    const date = parseLooseDate(String(r.date ?? ""));
    const debit = num(r.debit);
    const credit = num(r.credit);
    if (!date || (!debit && !credit) || (debit && credit)) continue;
    const particulars = String(r.particulars ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    lines.push({
      account,
      date,
      valueDate: null,
      cheque: null,
      particulars,
      debit,
      credit,
      balance: r.balance == null || r.balance === "" ? null : Number(String(r.balance).replace(/[^\d.-]/g, "")) || null,
      kind: classifyBankLine(particulars, debit, credit),
      reference: (typeof r.reference === "string" && r.reference.trim().toUpperCase()) || referenceOf(particulars),
      currency,
    });
  }
  return { lines, currency };
}

/** Run the reader on the statement text and wait up to `waitMs`. */
export async function readStatementWithAgent(text: string, waitMs = 45_000) {
  const agentId = statementAgentId();
  if (!agentId) return null;
  try {
    const id = await startExecution(agentId, { statement_text: text.slice(0, STATEMENT_TEXT_LIMIT) });
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2_000));
      const ex = await getExecution(id);
      if (TERMINAL.has(ex.status || "")) return ex.status === "completed" ? linesFromAgent(executionResult(ex)) : null;
    }
    return null;
  } catch (err) {
    console.warn("[statement-agent] failed", err instanceof Error ? err.message : err);
    return null;
  }
}
