# Architecture — Vibrium Trade Suite

## High-level

```
Browser (Next.js App Router)
  → /api/vibrium/token          (service account → JWT)
  → /api/proxy/[...path]        (customer Vibrium REST, avoids CORS)
  → /api/chat (+ /start)        (agents-api conversational copilot)
  → Vibrium staging APIs
       /agents, /agent-executions
       /voice-bots
       /workflows, /add-lead
       /uploads/presigned-url
       email-ses threads
```

**No Trade domain Lambdas.** Orchestration = SPA deal store + Vibrium primitives.

## System of record (current)

| Concern | Store |
|---------|--------|
| Deals, stages, selections, routing map | Zustand + `localStorage` (`vibrium-trade-store-v1`) |
| Documents | S3 via Vibrium presigned upload; keys on Deal |
| AI audit | `agent-executions` records |
| Outreach state | Vibrium contacts/workflows + local enrollment rows |
| Email history | SES threads API (when mailbox registered) |

**Limit:** not multi-user durable. Add `/trade/*` APIs only when concurrent ops users need a shared SoR.

## App structure

```
src/
  app/
    page.tsx                 Landing
    (app)/                   Authenticated-style shell modules
      deals/ intake/ quotes/ outreach/ vault/ routing/ copilot/ docs/
    api/
      vibrium/token/
      proxy/[...path]/
      chat/  chat/start/
      health/
  components/ layout, ui, copilot, shared
  lib/ vibrium/*, trade/{store,parsers,agentSpecs}, utils, rate-limit
  services/ vibriumClient, agentsApi, channelsApi
  types/ trade.ts, vibrium.ts
```

## Vibrium integration details

### Auth

Server mints JWT with Basic auth against  
`POST /v1/customers/{id}/auth/token`.  
Browser warms `/api/vibrium/token`; proxy uses server-side `vibriumFetch`.

### Worker agents

- CRUD: `/agents` with `bot_kind: "worker"`
- Run: `POST /agent-executions` `{ agent_id, input }` → poll GET until terminal
- Media: `format: document_url` on input fields (markitdown/vision)

### Conversational agents

- Configured as `VB*` voice/WhatsApp bots in Quantum UI
- Web copilot: `agents-api` chat completions via `/api/chat` (`channel: "whatsapp"` for markdown survival)
- Outreach: enroll with `POST /add-lead` + `workflow_id` (api-integrated workflow)

### Workflows

Runtime nodes today (platform): WhatsApp message/interactive, voice_call, whatsapp_agent, delay, end.  
Design factory/buyer chase graphs in Quantum UI; store IDs in Agent Routing.

## Domain model (SPA)

See `src/types/trade.ts`:

- `DealStage`: Phase A active stages + future B–G placeholders
- `RequirementFields`, `QuoteMatrix`, `TimelineEvent`, `OutreachEnrollment`, `DealDocument`
- `AgentRoutingMap`: slot → AA*/VB*/workflow id

## Environments

| | |
|--|--|
| Staging API | `https://api-staging.vibrium.ai` |
| Agents API | `https://agents-api.vibrium.ai` |
| Org | existing `org_kseKmYgURrloPdO5` (same family as other automations) |
| Hosting | Vercel project `vibrium-trade-suite` |

## References

- Platform deep-dive: [agents/VIBRIUM_PLATFORM.md](../agents/VIBRIUM_PLATFORM.md)
- Related codebases: [references/RELATED_REPOS.md](../references/RELATED_REPOS.md)
- Locked decisions: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
