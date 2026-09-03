# Phase A — Requirement → Factory outreach → Quote → Selection

**Status:** Shipped (local + Vercel).  
**PPT steps:** 1–4 (see process map).

## Goals

Automate the first buying-agency loop without new domain APIs:

1. Capture buyer requirement (email / upload)
2. Outreach factories (WhatsApp / email / voice via workflows)
3. Normalize factory AS/quote sheet → SKU matrix
4. Buyer selects SKUs (and optional chase)

## UI surfaces

| Route | Function |
|-------|----------|
| `/intake` | Paste enquiry, Petrageous fixture, worker extract, SES threads |
| `/outreach` | Enroll factory or buyer chase via `add-lead` |
| `/quotes` | Upload AS sheet, matrix, select, lock |
| `/deals`, `/deals/[id]` | Board + deal room timeline |
| `/routing` | Map slots → AA*/VB*/workflow; provision workers |
| `/copilot` | Ops conversational agent |
| `/vault` | Document list |

## Agents

| Slot | ID (staging) | Notes |
|------|----------------|-------|
| `requirement_extractor` | **AA00000025** | Input `email_text`; local fallback parser exists |
| `quote_normalizer` | **AA00000026** | Needs `document_url`; fixture matrix fallback if no public URL |
| `factory_outreach` | *(assign VB*)* | Persona in Routing page / AGENT_ROSTER |
| `buyer_selection_chase` | *(assign VB*)* | same |
| `ops_copilot` | env `VIBRIUM_OPS_COPILOT_BOT_ID` | Web chat |
| `wf_factory_outreach` | *(assign workflow)* | api-integrated |
| `wf_buyer_selection_chase` | *(assign workflow)* | api-integrated |

Provision script: `npm run provision` → `scripts/provision-phase-a.mjs`.

## Sample artefacts used

Under `docs/samples/Sourcing/`:

| File | Use |
|------|-----|
| `Detailed_Sourcing_Process_Buying_Agency_Model_.pptx` | Full 48-step process (email screenshots) |
| `AS LEATHER TOYS 6.3.25.xlsx` | Quote / AS sheet (also in `docs/fixtures/`) |
| Process map markdown | Structured steps |

Fixture email text: `PETRAGEOUS_FIXTURE_EMAIL` in `src/lib/trade/parsers.ts`.

## Demo script

1. Intake → Load Petrageous fixture → Extract (worker or local) → Create deal  
2. Outreach → Y.K. Industries → enroll (workflow if configured)  
3. Quotes → upload AS LEATHER TOYS → select SKUs → Lock selection  
4. Copilot: “What’s next on this deal?”

## Known gaps (intentional)

- Dispositions often set manually until workflow callbacks are wired
- Quote worker needs a publicly reachable `document_url` (presign)
- Conversational bots/workflows must be created in Quantum UI and pasted into Routing
- Deal store is per-browser

## Code entry points

- Specs: `src/lib/trade/agentSpecs.ts`
- Parsers / fallbacks: `src/lib/trade/parsers.ts`
- Store: `src/lib/trade/store.ts`
- Workers API: `src/services/agentsApi.ts`
- Channels / add-lead / uploads: `src/services/channelsApi.ts`
