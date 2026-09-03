# Vibrium Trade — Sourcing Suite

Buying-agency sourcing automation on **existing Vibrium APIs** (worker agents + conversational agents + workflows). No new domain Lambdas.

Phase A (live): **Requirement → Factory outreach → Quote matrix → Buyer selection**.

## Stack

- Next.js 15 App Router, React 19, Tailwind v4
- Vibrium staging: token BFF, `/api/proxy/*`, worker executions, add-lead, SES threads, agents-api copilot
- Deploy: Vercel

## Deployed

- **Production:** https://vibrium-trade-suite.vercel.app
- **GitHub:** https://github.com/pj-022/vibrium-trade-suite
- Workers on staging: `AA00000025` (requirement), `AA00000026` (quote)

## Local

```bash
cp .env.example .env.local
# fill from HR_Workflow / payment_automation service account
npm install
npm run dev
```

Open http://localhost:3000 → Enter suite.

Health: `GET /api/health` (mints a staging token).

## Provision Phase A workers

```bash
node --env-file=.env.local scripts/provision-phase-a.mjs
```

Then paste `AA*` IDs into **Agent Routing**. Assign existing `VB*` bots and api-integrated workflow IDs for outreach / buyer chase.

## Golden path

1. Intake → Load Petrageous fixture → Extract → Create deal
2. Outreach → Enroll Y.K. Industries (WhatsApp/email/voice)
3. Quotes → Upload `docs/fixtures/AS LEATHER TOYS 6.3.25.xlsx` → select SKUs → lock
4. Copilot for next-step Q&A

## Docs

- [docs/Sourcing-Buying-Agency-Process-Map.md](docs/Sourcing-Buying-Agency-Process-Map.md)
- [docs/RUNBOOK.md](docs/RUNBOOK.md)
