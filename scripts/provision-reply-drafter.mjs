#!/usr/bin/env node
/**
 * Provision / upgrade the dedicated mail reply drafter (a worker agent, not the chat Copilot).
 *
 * The reply-accuracy backtest showed the chat Copilot keeps its short chat style
 * (~24 words) even when told the person usually writes ~60, so drafts read like
 * WhatsApp answers. This worker is written for email only.
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-reply-drafter.mjs            # create, prints the id
 *   node --env-file=.env.local scripts/provision-reply-drafter.mjs --upgrade  # patch VIBRIUM_REPLY_DRAFTER_AGENT_ID
 */
const API = (process.env.VIBRIUM_API_BASE_URL || "https://api-staging.vibrium.ai").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;
const UPGRADE = process.argv.includes("--upgrade");
const AGENT_ID = process.env.VIBRIUM_REPLY_DRAFTER_AGENT_ID;

if (!CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}
if (UPGRADE && !AGENT_ID) {
  console.error("--upgrade needs VIBRIUM_REPLY_DRAFTER_AGENT_ID");
  process.exit(1);
}

export const DRAFTER = {
  name: "Trade Mail Reply Drafter",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description:
    "Drafts the email reply an SNSPL merchandiser would send to the newest mail in a thread, in that person's own style.",
  persona: `You are a senior merchandiser at Savvy Net Sourcing (SNSPL), a buying agency between overseas buyers (pet, hardlines, softlines importers) and Indian factories. You write business email replies that a colleague reviews and sends under their own name.

You write EMAIL, not chat:
1. Write like the example replies you are given — same greeting, sentence length, level of detail and the kind of follow-up points they add. When examples are given, match their typical length; the brief also states the person's usual length.
2. A good merchandiser reply moves the order forward: it answers the question, confirms or corrects what they sent, and states the next step and who does it.
3. Use only facts from the thread and the deal notes. Never invent prices, quantities, dates, PO or container numbers or payment status. If a needed figure is missing, write a placeholder such as [date] or [qty].
4. Never mention that you are an AI, never add notes to the reader, no markdown, no subject line.
5. Follow every instruction in the brief (who to reply to, how to sign off).`,
  task: `Read brief (instructions, deal background, past examples and the email thread).
Return ONLY JSON: {"reply": "<the full plain-text email body, greeting to sign-off, paragraphs separated by blank lines>"}.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 2, timeout_seconds: 90 },
  input_schema: {
    type: "object",
    required: ["brief"],
    properties: {
      brief: { type: "string", description: "Drafting instructions, deal background, examples and the email thread" },
    },
  },
  output_schema: {
    type: "object",
    required: ["reply"],
    properties: {
      reply: { type: "string", description: "Plain-text email body, greeting to sign-off" },
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
  await call(token, "PATCH", `agents/${encodeURIComponent(AGENT_ID)}`, DRAFTER);
  console.log("reply_drafter", AGENT_ID, "updated");
} else {
  const agent = await call(token, "POST", "agents", DRAFTER);
  console.log("reply_drafter", agent.agent_id || agent.bot_id || agent.id);
  console.log("Set VIBRIUM_REPLY_DRAFTER_AGENT_ID to this id");
}
