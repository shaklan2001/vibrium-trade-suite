#!/usr/bin/env node
/**
 * Provision Phase A worker agents on the existing Vibrium org.
 * Usage: node --env-file=.env.local scripts/provision-phase-a.mjs
 */
const API = (process.env.VIBRIUM_API_BASE_URL || "").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;

if (!API || !CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}

const REQUIREMENT = {
  name: "Trade Requirement Extractor",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description:
    "Extracts structured sourcing requirements from buyer emails or enquiry documents.",
  persona:
    "You are a senior sourcing analyst for a buying agency. Extract precise commercial fields. Prefer null over guessing.",
  task: "Parse the buyer enquiry and return structured requirement fields with confidence 0-1.",
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 8, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    properties: {
      email_text: { type: "string" },
      document_url: { type: "string", format: "document_url" },
    },
  },
  output_schema: {
    type: "object",
    required: ["productCategory", "summary", "confidence"],
    properties: {
      productCategory: { type: "string" },
      materials: { type: "string" },
      targetRetailPrice: { type: "number" },
      targetFactoryCost: { type: "number" },
      currency: { type: "string" },
      destination: { type: "string" },
      buyerContacts: { type: "array", items: { type: "string" } },
      urgency: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
};

const QUOTE = {
  name: "Trade Quote / AS Sheet Normalizer",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description:
    "Normalizes factory AS/quote Excel sheets into a structured SKU quote matrix.",
  persona:
    "You are a merchandising ops specialist. Emit clean SKU rows with prices.",
  task: "Parse the quote/AS spreadsheet and return factory name + SKU matrix.",
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 12, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["skus"],
    properties: {
      factoryName: { type: "string" },
      currency: { type: "string" },
      skus: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemCode: { type: "string" },
            description: { type: "string" },
            imageRef: { type: "string" },
            moq: { type: "number" },
            unitPrice: { type: "number" },
            currency: { type: "string" },
            packingNotes: { type: "string" },
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
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const json = await res.json();
  const token = json.data?.token || json.token;
  if (!token) {
    console.error(json);
    throw new Error(`auth failed ${res.status}`);
  }
  return token;
}

async function create(token, body) {
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/agents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    throw new Error(`create failed ${res.status}`);
  }
  return json.data?.agent || json.agent || json.data || json;
}

const token = await mint();
const req = await create(token, REQUIREMENT);
const quote = await create(token, QUOTE);
console.log("requirement_extractor", req.agent_id || req.bot_id);
console.log("quote_normalizer", quote.agent_id || quote.bot_id);
console.log("Paste these IDs into Agent Routing in the app.");
