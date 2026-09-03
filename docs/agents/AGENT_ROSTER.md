# Agent roster — Vibrium Trade

## Phase A (live)

### Workers

#### `requirement_extractor` → **AA00000025**

- Spec: `src/lib/trade/agentSpecs.ts` → `REQUIREMENT_EXTRACTOR_SPEC`
- Input: `email_text`, optional `document_url`
- Output: productCategory, materials, targetRetailPrice, targetFactoryCost, currency, destination, buyerContacts, urgency, summary, confidence
- Fallback: `extractRequirementLocal()` in `parsers.ts`

#### `quote_normalizer` → **AA00000026**

- Spec: `QUOTE_NORMALIZER_SPEC`
- Input: `document_url` (xlsx), optional `notes`
- Output: factoryName, currency, skus[]
- Fallback: leather-toys fixture matrix in Quotes UI

### Conversational (assign IDs in Agent Routing)

#### `factory_outreach` (VB*)

Persona (summary): Buying-agency coordinator asking factory to quote; collect disposition.

Dispositions: `QuotePromised` | `NeedClarification` | `Declined` | `EscalateToHuman`

Full text: `FACTORY_OUTREACH_PERSONA` in `agentSpecs.ts`.

#### `buyer_selection_chase` (VB*)

Dispositions: `Selected` | `NeedMoreTime` | `EscalateToHuman`

#### `ops_copilot` (VB*)

Env: `VIBRIUM_OPS_COPILOT_BOT_ID` — web chat via `/api/chat`.

### Workflows

| Slot | Purpose |
|------|---------|
| `wf_factory_outreach` | api-integrated WA/voice agent graph; enroll with `add-lead` |
| `wf_buyer_selection_chase` | same for buyer |

---

## Phase B–G (planned slots)

| Phase | Worker slots | Conversational slots |
|-------|--------------|----------------------|
| B | `artwork_checklist_extractor`, `sample_request_summarizer` | `artwork_approval_chase`, `sample_dispatch_chase` |
| C | `pi_extractor`, `po_extractor`, `pi_po_discrepancy` | `po_ack_chase` |
| D | `upc_barcode_matcher`, `packaging_photo_checklist` | barcode/packaging approval chase |
| E | `inspection_photo_summarizer`, `production_status_extractor` | `production_followup`, `pp_sample_chase` |
| F | `booking_extractor`, `cbm_container_planner` | `sailing_confirm` |
| G | `final_docs_pack_check`, `payment_clock`, `commission_checklist` | payment/release reminders |

Detailed behaviours: [phases/PHASES_B_TO_G.md](../phases/PHASES_B_TO_G.md).

---

## How to provision workers

```bash
npm run provision
# or Agent Routing → “Provision worker agents”
```

List org agents: Agent Routing → Refresh from org (calls `GET /agents?bot_kind=worker`).

---

## How to provision conversational bots

1. Open Quantum UI (tech-vibrium `quantum-ui`) for the same org  
2. Create WhatsApp/voice bot with persona + dispositions  
3. Approve WA templates if needed  
4. Create api-integrated workflow with `whatsapp_agent` / `voice_call` nodes  
5. Paste `VB*` and `workflow_id` into Agent Routing  

Platform notes: [VIBRIUM_PLATFORM.md](./VIBRIUM_PLATFORM.md).
