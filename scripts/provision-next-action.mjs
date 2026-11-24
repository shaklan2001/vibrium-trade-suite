#!/usr/bin/env node
/**
 * Provision / upgrade the Next Action worker: reads a deal's emails across all threads and says the
 * one next step, who should do it and which emails it rests on. Used by src/lib/mail/nextAction.ts.
 *
 *   node --env-file=.env.local scripts/provision-next-action.mjs            # create, prints the id
 *   node --env-file=.env.local scripts/provision-next-action.mjs --upgrade  # patch VIBRIUM_NEXT_ACTION_AGENT_ID
 */
const API = (process.env.VIBRIUM_API_BASE_URL || "https://api-staging.vibrium.ai").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;
const UPGRADE = process.argv.includes("--upgrade");
const AGENT_ID = process.env.VIBRIUM_NEXT_ACTION_AGENT_ID;

if (!CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}
if (UPGRADE && !AGENT_ID) {
  console.error("--upgrade needs VIBRIUM_NEXT_ACTION_AGENT_ID");
  process.exit(1);
}

const AGENT = {
  name: "Trade Next Action",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description:
    "Reads a deal's emails across all threads and names the single next step: what to do, who does it, for whom, by when, and which emails it rests on.",
  persona: `You are the operations lead at Savvy Net Sourcing (SNSPL), a buying agency between overseas buyers and Indian factories. You read one deal's emails (all threads, oldest to newest) and decide the single next step SNSPL has to take.

Rules:
1. Name ONE concrete step, in one sentence, that starts with a verb: "Send the BL draft to the buyer for approval", "Ask the factory to confirm the 14 Dec ready date", "Chase the buyer for the balance payment of USD 8,400". Never write "follow up" or "monitor" alone.
2. Choose the oldest thing that is still open: a question from them we have not answered, an approval we asked for and did not get, a payment not confirmed, a document that is missing. If our side already did it in a later email, it is not open.
3. The newest email wins over older ones and over any deal field. Use the team notes when they say something that is not in the emails.
4. owner: the SNSPL person who has been handling the thread (a name that signs our emails), else null. to: the party the step is for (buyer, factory, forwarder or a name).
5. due: a date (ISO yyyy-mm-dd) only if an email states or clearly implies one; else null.
6. based_on: the ids in square brackets of the emails the step rests on (one to three). Never invent an id.
7. If nothing is open, the step is "No action needed: <why>" with confidence 0.8.
8. confidence 0-1: how sure you are this is the right next step.`,
  task: `Read deal_brief. Return ONLY JSON matching the output schema.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 4, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    required: ["deal_brief"],
    properties: {
      deal_brief: { type: "string", description: "The deal's emails across all threads, open items and team notes" },
    },
  },
  output_schema: {
    type: "object",
    required: ["action", "confidence"],
    properties: {
      action: { type: "string", description: "The single next step, one sentence starting with a verb" },
      owner: { description: "SNSPL person, or null when not clear" },
      to: { description: "Party the step is for, or null" },
      due: { description: "Date yyyy-mm-dd, or null when no date is stated" },
      based_on: { type: "array", items: { type: "string" }, description: "Ids of the emails the step rests on" },
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
  await call(token, "PATCH", `agents/${encodeURIComponent(AGENT_ID)}`, AGENT);
  console.log("next_action", AGENT_ID, "updated");
} else {
  const agent = await call(token, "POST", "agents", AGENT);
  console.log("next_action", agent.agent_id || agent.bot_id || agent.id);
  console.log("Set VIBRIUM_NEXT_ACTION_AGENT_ID to this id");
}
