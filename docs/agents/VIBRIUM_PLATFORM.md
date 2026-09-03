# Vibrium platform notes (for Trade suite developers)

Source of truth code lives in `/Users/piyushjha/Documents/personal/tech-vibrium`.

## Two products in the workspace

| Path | Role |
|------|------|
| `tech-vibrium/quantum-ui` | Portal (Next.js) — bots, workflows, campaigns, HR suite |
| `tech-vibrium/vibrium-backend` | AWS Lambda/SAM APIs |

Trade suite is a **separate product SPA** that calls the same backend APIs.

## Agent kinds

| Kind | ID prefix | Runtime |
|------|-----------|---------|
| Conversational | `VB*` | VAPI voice + agents-api WhatsApp/chat |
| Worker | `AA*` + `bot_kind=worker` | LiteLLM tool loop in `agent-executions` |
| Functional | `AA*` + `bot_kind=functional` | Domain Lambdas (HR); not used by Trade yet |

Worker entry points:

- `vibrium-backend/aws-lambda-endpoints/agents-meta/main.py`
- `vibrium-backend/aws-lambda-endpoints/agent-executions/main.py`
- `worker_agent_utils.py`

## Workflows

- Stored via `workflows-put`
- Enroll: `add-lead` with `workflow_id` (often `api-integrated-zw…`)
- Runtime: `workflow-node-event-processor` dispatches nodes (WA, voice, delay, …)

Trade should prefer **existing node types**; do not add custom node types unless extending the platform.

## Channels Trade uses

| Channel | APIs |
|---------|------|
| Email | `email-ses-send`, `email-ses-inbound-processor`, `email-ses-threads-get` |
| WhatsApp | whatsapp-* + workflow whatsapp_agent |
| Voice | voice bots + workflow voice_call |
| Uploads | `/uploads/presigned-url` |

## Auth

- Auth0 orgs = `customer_id`
- Service account Basic → JWT (`/auth/token`)
- Trade BFF never exposes password to the browser

## Patterns copied into Trade

| From | What |
|------|------|
| HR_Workflow | Modular shell, pollUntil, channel badges, agent routing UX |
| payment_automation | `/api/chat` proxy, token mint pattern, Vercel deploy |
| KYC / Niva docs in tech-vibrium/docs | Workflow enroll + disposition design |

## Docs in tech-vibrium worth reading

- `docs/KYC_Agent_Workflow_Design.md`
- `docs/NivaBupa_Dropoff_Recovery_Workflow.md`
- `docs/Cart_Recovery_Test_Config_Handoff.md`
- `aws-lambda-endpoints/DEPLOYMENT_GUIDE.md`
