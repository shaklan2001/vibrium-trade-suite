# Continuation guide — develop Vibrium Trade from this repo

Use **this repository only** (`vibrium-trade-suite`) for further product work. The old `export_automation` demo UI is obsolete; its useful content has been copied into `docs/` here.

---

## 1. What already exists (Phase A)

Shipped and deployed:

- Next.js product SPA on Vercel: https://vibrium-trade-suite.vercel.app
- Existing Vibrium APIs only (no `/trade` Lambdas)
- Worker agents: `AA00000025` (requirement), `AA00000026` (quote)
- Modules: Deal Board, Intake, Quotes, Outreach, Vault, Agent Routing, Ops Copilot
- Deal SoR: browser Zustand persist + S3 uploads + agent execution audit + workflow enrollments

Golden path: Petrageous enquiry → factory outreach → AS LEATHER TOYS quote → SKU selection.

Details: [phases/PHASE_A.md](./phases/PHASE_A.md), [RUNBOOK.md](./RUNBOOK.md).

---

## 2. How to run locally

```bash
cd /Users/piyushjha/Documents/personal/vibrium-trade-suite
cp .env.example .env.local   # or pull from Vercel: vercel env pull
npm install
npm run dev
```

Creds: same Vibrium org / service account as HR_Workflow and payment_automation.

Smoke: `curl http://localhost:3000/api/health`

---

## 3. Recommended build order (sequential)

Follow the buying-agency PPT order — do **not** skip ahead unless product asks:

| Order | Phase | Doc | Primary samples |
|-------|-------|-----|-----------------|
| Done | A Requirement → selection | [PHASE_A.md](./phases/PHASE_A.md) | `samples/Sourcing/` |
| Next | B Artwork & samples | [PHASES_B_TO_G.md](./phases/PHASES_B_TO_G.md#phase-b) | NP_*.pdf, specs PPT |
| Then | C PI / PO | same | PI 14682, PO 14682, Neater POs |
| Then | D Spec / barcode / packaging | same | UPC xlsx, barcodes, PACKAGING PDF |
| Then | E Production / inspection | same | Inspection pictures PDF |
| Then | F Booking / sailing | same | BKGCONF, CBM sheet |
| Then | G Final docs / pay / commission | same | PL PDF, PPT payment slides |

Trading packs (`Trading_V1`, `Trading_Vendor_Registration`) inform the **trading** mode later; sourcing Phase A–G is grounded in `samples/Sourcing/`.

---

## 4. Pattern to add a new phase (copy this)

For each phase:

1. **Read** the PPT steps in [Sourcing-Buying-Agency-Process-Map.md](./Sourcing-Buying-Agency-Process-Map.md) and open matching files under `samples/`.
2. **Define** worker agent(s): input/output JSON schema in `src/lib/trade/agentSpecs.ts` + provision via Routing UI or a new `scripts/provision-phase-*.mjs`.
3. **Define** conversational bot persona + dispositions; create `VB*` in Quantum UI; wire workflow (`api-integrated`) if chase is needed.
4. **Extend** `DealStage` / timeline / document types in `src/types/trade.ts`.
5. **Add** UI module under `src/app/(app)/…` and nav in `src/components/layout/app-shell.tsx`.
6. **Map** slots in Agent Routing (`src/lib/trade/store.ts` routing map).
7. **Document** IDs in RUNBOOK + AGENT_ROSTER.
8. **Deploy** (`git push` → Vercel; or `vercel --prod`).

Still **no new domain APIs** until multi-user durable SoR is required — see [architecture/ARCHITECTURE.md](./architecture/ARCHITECTURE.md).

---

## 5. Where decisions live

| Topic | Source |
|-------|--------|
| No new Trade APIs | [architecture/IMPLEMENTATION_PLAN.md](./architecture/IMPLEMENTATION_PLAN.md) |
| Channels: email + WA + voice | same |
| New repo + Vercel | same |
| Existing org | RUNBOOK |
| 48-step process | Process map + `samples/Sourcing/Detailed_Sourcing_Process_*.pptx` |

---

## 6. Cursor / agent tips

When prompting an agent in this repo:

1. Point it at `docs/README.md` + `docs/CONTINUATION_GUIDE.md` + the relevant phase section.
2. Tell it to use sample files under `docs/samples/Sourcing/` as ground truth.
3. Tell it **not** to rebuild the `export_automation` demo.
4. Prefer extending `agentSpecs.ts`, store types, and `(app)` routes over inventing a backend.

---

## 7. Open work after Phase A

- Assign real `VB*` + workflow IDs for factory outreach / buyer chase (templates on WABA).
- Improve quote_normalizer against real AS sheet layout (images embedded).
- Wire workflow disposition webhooks → deal timeline (today: manual disposition buttons).
- Decide when client SoR needs Dynamo/Postgres Trade APIs (only if multi-user).
