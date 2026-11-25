#!/usr/bin/env node
/**
 * Provision / upgrade the Bank Statement Reader worker: reads the text of a bank statement the built-in
 * parser could not place and returns its transactions as JSON. Used by src/lib/mail/statementAgent.ts.
 *
 *   node --env-file=.env.local scripts/provision-statement-reader.mjs            # create, prints the id
 *   node --env-file=.env.local scripts/provision-statement-reader.mjs --upgrade  # patch VIBRIUM_STATEMENT_READER_AGENT_ID
 */
const API = (process.env.VIBRIUM_API_BASE_URL || "https://api-staging.vibrium.ai").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;
const UPGRADE = process.argv.includes("--upgrade");
const AGENT_ID = process.env.VIBRIUM_STATEMENT_READER_AGENT_ID;

if (!CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}
if (UPGRADE && !AGENT_ID) {
  console.error("--upgrade needs VIBRIUM_STATEMENT_READER_AGENT_ID");
  process.exit(1);
}

const AGENT = {
  name: "Bank Statement Reader",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description: "Reads the text of a bank account statement or bank credit / debit advice (any bank, any layout) and returns every transaction as structured JSON.",
  persona: `You read the text of a bank account statement, or of a bank credit / debit advice, and list its transactions.

Rules:
1. One entry per transaction line. Join a narration that wraps over several lines into one particulars string.
2. date: yyyy-mm-dd. Use the statement period for a year that is not written on the line.
3. debit and credit: positive numbers; exactly one of them is non-zero. Decide by the running balance (it goes down on a debit, up on a credit), a CR/DR mark, or the column heading. If you cannot tell, leave the line out.
4. Do not list opening/closing balance, totals, page headers or footers.
5. reference: the bank or SWIFT reference or UTR written in the narration, else null.
6. currency: the account currency as a 3-letter code. account_last4: the last four digits of the account number, else null.
7. A credit or debit advice (e.g. HSBC "Credit Advice") is one transaction written as labelled fields, not a table. Use the transaction or value date; credit (or debit) is the amount credited (or debited) to the account; reference is the transaction reference; particulars name the payer ("By order of") or beneficiary, the payer bank and the payment details. A PDF often repeats the same values on a second page: list each advice once.
8. Never invent a line or an amount. Copy the amounts exactly.`,
  task: "Read statement_text. Return ONLY JSON matching the output schema.",
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 4, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    required: ["statement_text"],
    properties: { statement_text: { type: "string", description: "The text of the bank statement" } },
  },
  output_schema: {
    type: "object",
    required: ["transactions"],
    properties: {
      currency: { type: "string" },
      account_last4: { description: "Last four digits of the account number, or null" },
      transactions: {
        type: "array",
        items: {
          type: "object",
          required: ["date", "particulars"],
          properties: {
            date: { type: "string" },
            particulars: { type: "string" },
            debit: { type: "number" },
            credit: { type: "number" },
            balance: { description: "Running balance after the line, or null" },
            reference: { description: "Bank or SWIFT reference, or null" },
          },
        },
      },
    },
  },
};

async function mint() {
  const basic = Buffer.from(`${USER}:${PASS}`).toString("base64");
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/auth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  const json = await res.json();
  const token = json.data?.token || json.token;
  if (!token) throw new Error(`auth failed ${res.status}`);
  return token;
}

async function call(token, method, path, body) {
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    throw new Error(`${method} ${path} failed ${res.status}`);
  }
  return json.data?.agent || json.agent || json.data || json;
}

const token = await mint();
if (UPGRADE) {
  await call(token, "PATCH", `agents/${encodeURIComponent(AGENT_ID)}`, AGENT);
  console.log("statement_reader", AGENT_ID, "updated");
} else {
  const agent = await call(token, "POST", "agents", AGENT);
  console.log("statement_reader", agent.agent_id || agent.bot_id || agent.id);
  console.log("Set VIBRIUM_STATEMENT_READER_AGENT_ID to this id");
}
