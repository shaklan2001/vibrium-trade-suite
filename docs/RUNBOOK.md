# Vibrium Trade — Phase A runbook

## Org

Uses the existing Vibrium customer (same as HR / payment automations).

| Env | Typical value |
|-----|----------------|
| `VIBRIUM_API_BASE_URL` | `https://api-staging.vibrium.ai` |
| `VIBRIUM_AGENTS_API_BASE_URL` | `https://agents-api.vibrium.ai` |
| `VIBRIUM_CUSTOMER_ID` | existing `org_…` |
| `VIBRIUM_SERVICE_USERNAME` / `PASSWORD` | service account (server-only) |
| `VIBRIUM_OPS_COPILOT_BOT_ID` | `VB*` used for web copilot |

Set the same keys on **Vercel → Project → Settings → Environment Variables** (Preview + Production). Never prefix passwords with `NEXT_PUBLIC_`.

## Agent slots

Configure in-app at `/routing` (persisted in browser) or via `NEXT_PUBLIC_*` env.

| Slot | Kind | How to create |
|------|------|----------------|
| `requirement_extractor` | Worker `AA*` | `node --env-file=.env.local scripts/provision-phase-a.mjs` or Agent Routing → Provision |
| `quote_normalizer` | Worker `AA*` | same |
| `factory_outreach` | Conversational `VB*` | Quantum UI voice/WhatsApp bot; paste persona from Routing page |
| `buyer_selection_chase` | Conversational `VB*` | same |
| `ops_copilot` | Conversational `VB*` | `VIBRIUM_OPS_COPILOT_BOT_ID` |
| `wf_factory_outreach` | Workflow | Quantum UI: api-integrated workflow, WhatsApp/voice agent node, enroll via `add-lead` |
| `wf_buyer_selection_chase` | Workflow | same pattern for buyer |

Suggested dispositions:

- Factory: `QuotePromised`, `NeedClarification`, `Declined`, `EscalateToHuman`
- Buyer: `Selected`, `NeedMoreTime`, `EscalateToHuman`

Until workflow callbacks exist, dispositions can be set on the Outreach screen.

## Channels

| Channel | Integration |
|---------|-------------|
| Email | SES threads via `/email/ses/threads` (or `/email-ses/threads`) on Intake |
| WhatsApp | Workflow `whatsapp_agent` node + `add-lead` |
| Voice | Workflow `voice_call` node if WA templates lag |
| Portal | Deal timeline + copilot |

## Stage machine (ready for Phase B)

`requirement → outreach → quoting → selection → artwork → samples → pi_po → packaging → production → booking → docs_payment → closed`

UI automates only the first four. Later labels are shown as Phase B–G.

## Vercel

```bash
npx vercel --yes
npx vercel env add VIBRIUM_SERVICE_PASSWORD
npx vercel --prod
```

Smoke: `https://<deployment>/api/health`

## Demo script

Petrageous-style leather toys enquiry → Y.K. outreach → AS LEATHER TOYS normalize → buyer SKU selection.

## Next (Phase B)

Artwork / sample chase workers + conversational follow-up — same slot pattern, no new domain APIs until SoR requires it.


## Provisioned on staging (Phase A)

- `requirement_extractor`: **AA00000025**
- `quote_normalizer`: **AA00000026**
