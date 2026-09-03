# Vibrium Trade Suite — Documentation Index

**Repo:** [`vibrium-trade-suite`](https://github.com/pj-022/vibrium-trade-suite)  
**Production:** https://vibrium-trade-suite.vercel.app  
**Continue development here** — do not depend on `export_automation` (that repo’s UI was a throwaway demo).

This folder is the full knowledge base for product, process, architecture, agents, sample artefacts, and how to build Phase B→G.

---

## Start here

| Doc | Purpose |
|-----|---------|
| [CONTINUATION_GUIDE.md](./CONTINUATION_GUIDE.md) | **Read first** — how to keep building from this repo |
| [RUNBOOK.md](./RUNBOOK.md) | Env, agent IDs, Vercel, demo script, ops |
| [architecture/ARCHITECTURE.md](./architecture/ARCHITECTURE.md) | System design, APIs used, SoR constraints |
| [architecture/IMPLEMENTATION_PLAN.md](./architecture/IMPLEMENTATION_PLAN.md) | Locked product decisions from Phase A build |
| [Sourcing-Buying-Agency-Process-Map.md](./Sourcing-Buying-Agency-Process-Map.md) | 48-step buying-agency ground truth |

---

## Product & business

| Doc | Purpose |
|-----|---------|
| [product/BRD-Vibrium-Trade.md](./product/BRD-Vibrium-Trade.md) | Original BRD (full product vision) |
| [product/Vibrium-Trade-Business-Enablement-Guide.md](./product/Vibrium-Trade-Business-Enablement-Guide.md) | Sales / enablement narrative |
| [product/Sourcing-Buying-Agency-Process-Map.md](./product/Sourcing-Buying-Agency-Process-Map.md) | Same process map (product copy) |

Word exports also live under `product/*.docx`.

---

## Phases

| Doc | Scope |
|-----|--------|
| [phases/PHASE_A.md](./phases/PHASE_A.md) | Requirement → outreach → quote → selection (**shipped**) |
| [phases/PHASES_B_TO_G.md](./phases/PHASES_B_TO_G.md) | What to build next, step-by-step, with sample docs |

---

## Agents & Vibrium platform

| Doc | Purpose |
|-----|---------|
| [agents/AGENT_ROSTER.md](./agents/AGENT_ROSTER.md) | Worker + conversational slots, schemas, personas, IDs |
| [agents/VIBRIUM_PLATFORM.md](./agents/VIBRIUM_PLATFORM.md) | How Vibrium APIs / workers / bots / workflows work |
| [references/RELATED_REPOS.md](./references/RELATED_REPOS.md) | HR_Workflow, payment_automation, tech-vibrium paths |

---

## Client sample artefacts

| Folder | Contents |
|--------|----------|
| [samples/Sourcing/](./samples/Sourcing/) | Buying-agency sourcing pack + process PPT + POs/PIs/barcodes/booking |
| [samples/Trading_V1/](./samples/Trading_V1/) | Trading flow sample docs (BL, inspection, booking, etc.) |
| [samples/Trading_Vendor_Registration/](./samples/Trading_Vendor_Registration/) | Vendor registration slide-wise artefacts (zips excluded — see inventory) |
| [fixtures/](./fixtures/) | Small fixtures used by the app (e.g. AS LEATHER TOYS xlsx) |

Each sample folder has `INVENTORY.md`.

---

## Code map (app)

| Path | Role |
|------|------|
| `src/app/(app)/*` | Product modules (deals, intake, quotes, outreach, vault, routing, copilot) |
| `src/app/api/*` | Token BFF, proxy, chat, health |
| `src/services/*` | Vibrium client wrappers |
| `src/lib/trade/*` | Deal store, parsers, agent specs |
| `src/types/*` | Domain types |
| `scripts/provision-phase-a.mjs` | Create Phase A worker agents |

---

## External context (not in this repo)

| Resource | Path / URL |
|----------|------------|
| Vibrium backend | `/Users/piyushjha/Documents/personal/tech-vibrium/vibrium-backend` |
| Quantum UI | `/Users/piyushjha/Documents/personal/tech-vibrium/quantum-ui` |
| HR Suite reference | `/Users/piyushjha/Documents/personal/HR_Workflow` |
| Payment / chat BFF reference | `/Users/piyushjha/Documents/personal/payment_automation` |
| Legacy demo (ignore UI) | `/Users/piyushjha/Documents/personal/export_automation` |
