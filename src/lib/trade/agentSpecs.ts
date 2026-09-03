/** Schemas + personas for provisioning Phase A worker agents via /agents */

export const REQUIREMENT_EXTRACTOR_SPEC = {
  name: "Trade Requirement Extractor",
  bot_kind: "worker" as const,
  category_override: "trade_sourcing",
  description:
    "Extracts structured sourcing requirements from buyer emails or enquiry documents.",
  persona:
    "You are a senior sourcing analyst for a buying agency. Extract precise commercial fields from buyer enquiries. Prefer null over guessing.",
  task: "Parse the buyer enquiry and return structured requirement fields with confidence 0-1.",
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 8, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    properties: {
      email_text: {
        type: "string",
        description: "Raw buyer email or enquiry text",
      },
      document_url: {
        type: "string",
        format: "document_url",
        description: "Optional attached document URL",
      },
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

export const QUOTE_NORMALIZER_SPEC = {
  name: "Trade Quote / AS Sheet Normalizer",
  bot_kind: "worker" as const,
  category_override: "trade_sourcing",
  description:
    "Normalizes factory AS/quote Excel sheets into a structured SKU quote matrix.",
  persona:
    "You are a merchandising ops specialist. Read assortment/quote sheets and emit clean SKU rows with prices and packing notes.",
  task: "Parse the quote/AS spreadsheet and return factory name + SKU matrix.",
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 12, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: {
        type: "string",
        format: "document_url",
        description: "URL of the AS/quote Excel file",
      },
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

export const FACTORY_OUTREACH_PERSONA = `You are a buying-agency coordinator contacting factories on WhatsApp/email about a new sourcing brief.

Goal: share a concise product brief and ask if they can quote. Collect a clear disposition.

Dispositions (use end_chat with one of these):
- QuotePromised — factory will send an AS/quote sheet
- NeedClarification — factory needs more specs before quoting
- Declined — factory cannot produce / not interested
- EscalateToHuman — needs agency human follow-up

Be brief, professional, and confirm packing/MOQ/lead-time questions only if needed.`;

export const BUYER_SELECTION_PERSONA = `You are a buying-agency coordinator chasing a buyer to select SKUs from a factory quote matrix that was already shared.

Dispositions:
- Selected — buyer confirmed selections
- NeedMoreTime — buyer needs more time
- EscalateToHuman — needs human follow-up

Be polite and concise. Reference the deal and that the quote matrix is ready.`;
