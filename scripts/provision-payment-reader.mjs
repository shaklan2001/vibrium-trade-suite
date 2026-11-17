#!/usr/bin/env node
/**
 * Provision / upgrade the Payment Reader worker: reads one payment email (and its remittance
 * advice / TT copy / invoice / statement attachment) into a ledger entry that can be matched
 * to POs. Used by src/lib/mail/payments.ts.
 *
 *   node --env-file=.env.local scripts/provision-payment-reader.mjs            # create, prints the id
 *   node --env-file=.env.local scripts/provision-payment-reader.mjs --upgrade  # patch VIBRIUM_PAYMENT_READER_AGENT_ID
 */
const API = (process.env.VIBRIUM_API_BASE_URL || "https://api-staging.vibrium.ai").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;
const UPGRADE = process.argv.includes("--upgrade");
const AGENT_ID = process.env.VIBRIUM_PAYMENT_READER_AGENT_ID;

if (!CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}
if (UPGRADE && !AGENT_ID) {
  console.error("--upgrade needs VIBRIUM_PAYMENT_READER_AGENT_ID");
  process.exit(1);
}

const READER = {
  name: "Trade Payment Reader",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description:
    "Reads a payment email and its remittance advice / TT copy / invoice into one ledger entry: who paid whom, how much, when, for which POs and invoices.",
  persona: `You are the accounts assistant at Savvy Net Sourcing (SNSPL), a buying agency between overseas buyers and Indian factories (and, for some orders, the trading company Global Praise). You read payment emails and their attachments and record exactly what they say.

Rules:
1. Decide what the email is: payment_received (money has reached the payee: "payment received", "credited", "funds received"), payment_sent (the payer says it has paid: TT copy, SWIFT/MT103, remittance advice, UTR, "we have remitted"), payment_request (asking for payment, invoice/debit note due, reminder, statement of dues), or other (not about a specific payment).
2. side: buyer = a buyer pays for goods (to SNSPL, Global Praise or the factory); factory = SNSPL / Global Praise / the buyer pays a factory or supplier; freight = forwarder, shipping line, CHA or courier charges; commission = agency commission to SNSPL; other.
3. amount: the payment amount as a number (no symbols or commas). For a request, the amount asked for. If several amounts are listed for different POs/invoices, put each in allocations and the total in amount.
4. allocations: one entry per PO (and/or invoice) the payment covers, with the amount for it when stated. PO numbers as written (e.g. "14837", "G 2625101", "4510217618"). Never invent a PO or invoice number.
5. value_date: the payment/credit date (ISO yyyy-mm-dd) if stated; for requests, the due date if stated.
6. reference: bank reference, UTR, SWIFT/MT103 reference or cheque number if present.
7. Read the attachment when one is given: remittance advices, TT copies and statements usually hold the amount, date and invoice/PO list.
8. If something is not stated, use null (or an empty list). Never guess amounts.
9. confidence 0–1: how clearly the email and attachment state the payment.`,
  task: `Read email_text (and document_url when given). Return ONLY JSON matching the output schema.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 6, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    required: ["email_text"],
    properties: {
      email_text: { type: "string", description: "The payment email (headers, subject, body)" },
      document_url: { type: "string", format: "document_url", description: "Remittance advice / TT copy / invoice / statement" },
    },
  },
  output_schema: {
    type: "object",
    required: ["kind", "confidence"],
    properties: {
      kind: { type: "string", enum: ["payment_received", "payment_sent", "payment_request", "other"] },
      side: { type: "string", enum: ["buyer", "factory", "freight", "commission", "other"] },
      payer: { description: "text, or null when not stated" },
      payee: { description: "text, or null when not stated" },
      amount: { description: "number, or null when not stated" },
      currency: { description: "text, or null when not stated" },
      value_date: { description: "text, or null when not stated" },
      reference: { description: "text, or null when not stated" },
      allocations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            po_number: { description: "text, or null when not stated" },
            invoice_number: { description: "text, or null when not stated" },
            amount: { description: "number, or null when not stated" },
          },
        },
      },
      summary: { type: "string", description: "One sentence: who paid / asked whom, how much, for what" },
      confidence: { type: "number" },
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
  await call(token, "PATCH", `agents/${encodeURIComponent(AGENT_ID)}`, READER);
  console.log("payment_reader", AGENT_ID, "updated");
} else {
  const agent = await call(token, "POST", "agents", READER);
  console.log("payment_reader", agent.agent_id || agent.bot_id || agent.id);
  console.log("Set VIBRIUM_PAYMENT_READER_AGENT_ID to this id");
}
