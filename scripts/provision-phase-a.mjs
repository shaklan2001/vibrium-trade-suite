#!/usr/bin/env node
/**
 * Provision / upgrade Phase A worker agents on the existing Vibrium org.
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-phase-a.mjs
 *   node --env-file=.env.local scripts/provision-phase-a.mjs --upgrade
 *
 * --upgrade patches NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR /
 * NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER (or AA00000025 / AA00000026) in place.
 */
const API = (process.env.VIBRIUM_API_BASE_URL || "https://api-staging.vibrium.ai").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;
const UPGRADE = process.argv.includes("--upgrade");

const REQ_ID =
  process.env.NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR || "AA00000025";
const QUOTE_ID =
  process.env.NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER || "AA00000026";

if (!API || !CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}

const REQUIREMENT = {
  name: "Trade Requirement Extractor",
  bot_kind: "worker",
  category_override: "trade_sourcing",
  description:
    "Senior buying-agency requirement analyst. Reads buyer emails and enquiry documents and emits a complete structured sourcing brief — never a partial guess.",
  persona: `You are the senior requirement analyst at Savvy Net Sourcing (SNSPL), a buying agency for pet / hardlines / softlines importers (Petrageous, Loving Pets, Neater Pets, Global Praise, etc.).

Your job is to turn messy buyer emails, forwards, and attached enquiry docs into a precise commercial brief the agency can use to approach factories.

Rules:
1. Extract every commercial signal that is present — do not invent prices, destinations, MOQs, or contacts.
2. If a field is not stated, omit the key (especially numbers) or use an empty string / empty array — never fabricate and never output null for numeric fields.
3. Treat "less than $X" / "under $X" / "max $X" as targetFactoryCost = X (numeric, no currency symbol).
4. Treat "around $X" / "approx $X" retail / MSRP as targetRetailPrice = X.
5. Capture ALL people and emails from From/To/Cc and signature blocks in buyerContacts (prefer "Name <email>" when both exist).
6. Infer productCategory as a short merchandising label (e.g. "Leather / suede toys"), not a full sentence.
7. materials should list substrates / constructions mentioned (leather, suede, silicone, etc.).
8. urgency: "high" if ASAP/urgent/rush/need this week; otherwise "normal" or "low" if explicitly soft-timed.
9. destination is the buyer's sell-in market / ship-to country if stated or strongly implied (e.g. US buyer brands → "USA"); otherwise omit.
10. currentSourcingNotes: existing factories, countries of origin, competitor refs (e.g. "currently made in India; Ethical is a source").
11. openQuestions: gaps the agency must clarify before factory outreach.
12. nextActions: concrete agency next steps (e.g. "Identify leather toy factories in India; request AS sheet under $1 FOB").
13. summary: 1–3 sentence ops-ready brief for the deal timeline.
14. confidence: 0–1 reflecting completeness of the source text (0.9+ when category + cost band + contacts are clear).
15. When document_url is provided, read it and merge facts with the email — document wins on conflict for specs/skus; email wins for commercial targets and contacts.`,
  task: `Parse the buyer enquiry (email_text and optional document_url).
Return ONLY valid JSON matching the output schema.
Populate every field you can support from evidence; leave unsupported optional fields null or [].
Be precise with numbers. Prefer agency-usable language in summary, openQuestions, and nextActions.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 12, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    properties: {
      email_text: {
        type: "string",
        description: "Raw buyer email, forward chain, or enquiry text",
      },
      document_url: {
        type: "string",
        format: "document_url",
        description:
          "Optional attached RFQ / design / enquiry document URL (xlsx, pdf, docx, images)",
      },
      agency_context: {
        type: "string",
        description:
          "Optional agency notes (known buyer, preferred factories, prior deals)",
      },
    },
  },
  output_schema: {
    type: "object",
    required: [
      "productCategory",
      "summary",
      "confidence",
      "buyerContacts",
      "currency",
      "urgency",
    ],
    properties: {
      productCategory: { type: "string" },
      materials: { type: "string" },
      targetRetailPrice: { type: "number" },
      targetFactoryCost: { type: "number" },
      currency: { type: "string" },
      destination: { type: "string" },
      buyerCompany: { type: "string" },
      buyerContacts: { type: "array", items: { type: "string" } },
      urgency: { type: "string" },
      currentSourcingNotes: { type: "string" },
      packingRequirements: { type: "string" },
      complianceNotes: { type: "string" },
      quantityHints: { type: "string" },
      openQuestions: { type: "array", items: { type: "string" } },
      nextActions: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
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
    "Merchandising ops specialist that turns factory AS / quote Excel sheets into a clean SKU matrix for buyer selection.",
  persona: `You are a merchandising operations specialist at Savvy Net Sourcing (SNSPL).

You normalize factory assortment / quote (AS) sheets — typically Excel workbooks with item codes, descriptions, photos, MOQs, unit FOB prices, and packing notes — into a clean SKU matrix the buyer can select from.

Rules:
1. Read the full spreadsheet (all relevant sheets). Prefer the sheet that looks like a quote / AS / price list.
2. Emit one row per sellable SKU / item code. Skip blank rows, totals, and header-only rows.
3. itemCode: factory item # / style # / SKU. Keep original codes (e.g. E26842).
4. description: full product name as written; do not invent marketing copy.
5. unitPrice: numeric FOB / factory unit price only (no currency symbols). If a range is given, use the lower bound and note the range in packingNotes.
6. moq: numeric minimum order quantity when present.
7. currency: from the sheet header or notes; default USD for US buyers.
8. factoryName: from header, cover sheet, or filename clues when explicit.
9. packingNotes: inner/master carton, pcs/ctn, CBM, assortment, or other packing remarks.
10. imageRef: cell reference, filename, or URL if the sheet embeds/links images; otherwise omit or empty string.
11. Include leadTimeDays / incoterm / paymentTerms when the sheet states them at header level.
12. Never invent SKUs that are not on the sheet. confidence reflects parse completeness.
13. If the workbook is unreadable or empty of SKUs, return skus: [] with a low confidence and notes explaining why.`,
  task: `Parse the AS/quote document at document_url (and optional notes).
Return ONLY valid JSON matching the output schema with every SKU row you can extract.
Prices and MOQs must be numbers. Prefer completeness over brevity.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 16, timeout_seconds: 240 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: {
        type: "string",
        format: "document_url",
        description: "Public URL of the AS / quote Excel (or PDF) file",
      },
      notes: { type: "string" },
      target_factory_cost: { type: "number" },
    },
  },
  output_schema: {
    type: "object",
    required: ["skus", "currency", "confidence"],
    properties: {
      factoryName: { type: "string" },
      currency: { type: "string" },
      quoteDate: { type: "string" },
      incoterm: { type: "string" },
      paymentTerms: { type: "string" },
      leadTimeDays: { type: "number" },
      notes: { type: "string" },
      confidence: { type: "number" },
      skus: {
        type: "array",
        items: {
          type: "object",
          required: ["itemCode", "description"],
          properties: {
            itemCode: { type: "string" },
            description: { type: "string" },
            imageRef: { type: "string" },
            moq: { type: "number" },
            unitPrice: { type: "number" },
            currency: { type: "string" },
            packingNotes: { type: "string" },
            innerCarton: { type: "number" },
            masterCarton: { type: "number" },
            cbm: { type: "number" },
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

async function patch(token, agentId, body) {
  const res = await fetch(
    `${API}/v1/customers/${CUSTOMER}/agents/${encodeURIComponent(agentId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    throw new Error(`patch ${agentId} failed ${res.status}`);
  }
  return json.data?.agent || json.agent || json.data || json;
}

const token = await mint();

if (UPGRADE) {
  console.log("Upgrading workers in place…");
  const req = await patch(token, REQ_ID, REQUIREMENT);
  const quote = await patch(token, QUOTE_ID, QUOTE);
  console.log("requirement_extractor", req.agent_id || REQ_ID, "updated");
  console.log("quote_normalizer", quote.agent_id || QUOTE_ID, "updated");
} else {
  const req = await create(token, REQUIREMENT);
  const quote = await create(token, QUOTE);
  console.log("requirement_extractor", req.agent_id || req.bot_id);
  console.log("quote_normalizer", quote.agent_id || quote.bot_id);
  console.log("Paste these IDs into Agent Routing, or re-run with --upgrade");
}
