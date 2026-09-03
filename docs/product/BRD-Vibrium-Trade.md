# Business Requirements Document (BRD)

## Vibrium Trade — Export Automation & Intelligence Platform

| Field | Value |
| --- | --- |
| **Product** | Vibrium Trade |
| **Service Provider** | Vibrium AI |
| **Document** | Business Requirements Document |
| **Version** | 1.0 |
| **Date** | August 2026 |
| **Status** | Draft for client review |
| **Related artefacts** | Interactive demo UI · Demo Director tour · Client intake (TBD) |

---

## 1. Executive summary

Vibrium Trade is an **AI-powered export/import automation and intelligence platform** for large sourcing companies that intermediate between importers (buyers) and manufacturers (exporters).

A typical deal cycle runs **120–180 days**. Manual coordination across RFQs, supplier outreach, quotes, samples, PI/PO, production, inspection, shipping documents, and payments creates delay risk, margin leakage, and operational overhead. Any hiccup late in the cycle is expensive.

Vibrium Trade turns this lifecycle into a **System of Intelligence and Action**:

1. **Automate** repeatable work via Digital Workers (agents) and visual workflows (Vibrium Flow) across email, WhatsApp, and voice.
2. **Orchestrate** every deal stage from RFQ intake through Bill of Lading release and customs clearance visibility.
3. **Inform** leadership with grounded AI insights, risk radar, predictions, and a Trade Copilot — numbers computed deterministically, narratives that only cite those facts.

This BRD defines the business requirements for the product as demonstrated and as intended for production delivery, including all modules, agents, automations, and success criteria.

---

## 2. Business context

### 2.1 Client profile

The target client is a **large sourcing company** that helps importers and exporters throughout the deal. They maintain a manufacturer/factory portfolio, run compliance and quality processes, and coordinate documents and payments across a multi-month cycle.

### 2.2 Deal shapes

| Mode | Parties | Sourcing company role |
| --- | --- | --- |
| **Managed** | Importer → Sourcing Co → Manufacturer | Full orchestration: match, negotiate, QC, docs, logistics visibility |
| **Referee** | Importer ↔ Manufacturer (direct) | Escrow / QC / referee; reduced commercial intensity, different fee model |

Both modes are first-class in the platform (`dealMode`).

### 2.3 High-level process (as-is)

1. Importer raises a request (RFQ).
2. Sourcing company searches portfolio + market for manufacturers.
3. Shortlist → deeper research → forward RFQ → collect compliance, pricing, quotations.
4. Present options to buyer; if acceptable → samples → testing.
5. PI issued → PO → advance payment → manufacturing starts.
6. Production / DUPRO samples → approval → production continues.
7. Final inspection (PSI) → booking → shipment ready → importer-side inspection as needed.
8. Bill of Lading issued when cargo is onboarded.
9. After sailing, importer owns customs/import overhead.
10. On arrival → balance payment → BL released → goods freed from customs → warehouse.

### 2.4 Pain points

| Pain | Business impact |
| --- | --- |
| Manual RFQ triage and supplier matching | Slow response; inconsistent shortlists |
| Chasing silent suppliers across channels/languages | Lost quotes; cycle slip |
| Quote comparison across Incoterm/FX/freight/duty | Wrong “cheapest” selections; later delays |
| Blind spots in 120–180 day production & logistics | Demurrage, air-freight contingency, missed cut-offs |
| Document/LC discrepancies found late | Bank presentation fails; cash locked |
| No single view of risk, ETA, and next actions | Leadership reacts late; margin eroded |
| Buyer updates are ad hoc | Trust and repeat business suffer |

### 2.5 Product pillars (Vibrium architecture)

| Pillar | Role in Vibrium Trade |
| --- | --- |
| **Vibrium Flow** | Visual workflow engine for multi-step trade journeys |
| **Vibrium Pulse** | Analytics, insights, risk, predictions |
| **Digital Workers** | Industry agents that act across WhatsApp, email, voice, and systems |
| **Memory & Context** | Deal/supplier history so agents do not repeat or invent |
| **Human-in-the-loop** | Approvals queue before high-impact outbound actions |
| **Integration layer** | Channels, carriers, inspection agencies, ERP, email |

---

## 3. Objectives

| ID | Objective | Measurable outcome |
| --- | --- | --- |
| O-1 | Reduce operational overhead on repeatable trade tasks | Hours automated / month; tasks auto-completed |
| O-2 | Shorten average deal cycle time toward target | Avg cycle days vs target (e.g. 135d) |
| O-3 | Improve supplier selection quality (not price-only) | OTD uplift; fewer delay events post-PO |
| O-4 | Surface risks early enough to mitigate | % risks acknowledged before due; demurrage events avoided |
| O-5 | Give leadership one pane of glass for business status | Daily brief adoption; time to answer “what’s at risk?” |
| O-6 | Improve importer experience with transparency | Portal usage; fewer “status?” inbound emails |
| O-7 | Keep humans in control of critical actions | Approval latency; zero unapproved high-risk sends |

---

## 4. Stakeholders & personas

| Persona | Primary needs | Key surfaces |
| --- | --- | --- |
| **Executive / Owner** | Pipeline, on-water value, cycle, margin, risks, automation ROI | Command Center, Insights, Risk, ROI |
| **Trade Ops Lead** | Deal progression, approvals, exceptions | Deals, Approvals, Inbox, Production |
| **Sourcing Manager** | RFQ match, supplier quality, quotes | RFQs, Suppliers, Discovery, Quote matrix |
| **QC / Inspection** | DUPRO/PSI schedule and outcomes | Inspections, Samples |
| **Logistics Coordinator** | Bookings, ETA, congestion, demurrage | Shipments, Trade Map, Risk |
| **Finance** | Advances, balances, LC, margins | Finance, Documents |
| **Compliance** | Cert expiry, audits | Compliance, Scorecards |
| **Importer (Buyer)** | Raise RFQ, approve quotes, track order/shipment/docs | Buyer Portal |
| **Platform Admin** | Integrations, rules, RBAC, audit | Admin |

**Manufacturer** remains largely external in Phase 1 — engaged via Comms Hub (email/WhatsApp/voice), not a full manufacturer portal (roadmap).

---

## 5. Glossary

| Term | Meaning |
| --- | --- |
| **RFQ** | Request for Quotation — buyer enquiry (product, spec, qty, target price, destination, certs) |
| **PI** | Proforma Invoice — seller’s binding offer-cum-invoice; advance often paid against PI |
| **PO** | Purchase Order — buyer’s formal confirmation of terms |
| **BL / B/L** | Bill of Lading — carrier receipt, contract of carriage, and **document of title** |
| **CI** | Commercial Invoice |
| **PL** | Packing List |
| **COO** | Certificate of Origin |
| **LC** | Letter of Credit |
| **TT** | Telegraphic Transfer |
| **PSI** | Pre-Shipment Inspection |
| **DUPRO** | During-production inspection |
| **AQL** | Acceptable Quality Limit (sampling) |
| **Incoterm** | EXW, FCA, FOB, CFR, CIF, DAP, DDP (Incoterms 2020) |
| **HS Code** | Harmonized System tariff classification |
| **ETD / ETA** | Estimated Time of Departure / Arrival |
| **ATD / ATA** | Actual Time of Departure / Arrival |
| **Demurrage / Detention** | Charges after free days at port / for container use |
| **Telex release** | Surrender of original BL for cargo release without physical originals |
| **BOE** | Bill of Entry (import customs) |
| **Landed cost** | Unit + freight + duty (+ other) normalized for comparison |
| **OTD** | On-Time Delivery % |
| **Priority Score** | 0–100 composite urgency/value/risk score per deal/RFQ |
| **Fact pack** | Structured metrics fed to AI; agents may only cite these facts |
| **HITL** | Human-in-the-loop approval before agent action executes |

---

## 6. Deal lifecycle (system of record spine)

The platform models **12 stages**. Every deal advances through them (or is lost/held). Aging in stage and Priority Score drive ops attention.

```text
1  RFQ Intake
2  Supplier Discovery
3  RFQ Dispatch
4  Quote Collection
5  Buyer Negotiation
6  Sampling Round 1
7  PI / PO / Advance
8  Production
9  Production Sample / DUPRO
10 Final Inspection / PSI
11 Booking / BL / Sailing
12 Transit / Balance Payment / BL Release / Clearance
```

**Requirements**

| ID | Requirement |
| --- | --- |
| BR-LC-001 | System SHALL persist stage, stage-entered timestamp, days-in-stage, and stage history per deal |
| BR-LC-002 | System SHALL support Managed and Referee modes with UI panels appropriate to mode |
| BR-LC-003 | System SHALL compute Priority Score (0–100) with configurable weights (value, urgency, aging, risk, strategic flag) |
| BR-LC-004 | Deal Room SHALL present unified timeline, documents, quotes, samples, payments, shipment, risks, and AI next-best-actions |

---

## 7. Functional requirements by module

### 7.1 Vibrium Pulse — Intelligence

#### 7.1.1 Executive Command Center

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-INT-001 | Dashboard SHALL show KPIs: active deals, pipeline value, on-water value, avg cycle vs target, OTD %, avg margin, hours automated | P0 |
| BR-INT-002 | Dashboard SHALL show stage distribution, volume/automation trends, open risks, Digital Worker status, live activity | P0 |
| BR-INT-003 | Dashboard SHALL show AI Daily Brief streamed from precomputed/grounded narratives | P0 |
| BR-INT-004 | All analytical views SHALL show “As of {sync time}” freshness | P0 |
| BR-INT-005 | Next Best Actions SHALL include rationale citing fact IDs | P0 |

#### 7.1.2 AI Insights & Predictions

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-INT-010 | Insights SHALL cover demand forecast, lane price index, lead-time prediction, supplier price benchmarking, margin drivers, seasonality | P0 |
| BR-INT-011 | Scenario Simulator SHALL recompute ETA/cost/margin/risk for scenarios (e.g. Red Sea +12 days; shift 30% volume to Vietnam) | P1 |

#### 7.1.3 Risk Radar

Rule-detected signals, AI-narrated. Severity: critical / high / medium / low.

| Signal | Description |
| --- | --- |
| Stale RFQ | RFQ idle beyond SLA |
| No Supplier Response | No quote within chase window |
| Quote Expiring | Validity ending soon |
| Sample Overdue | Courier/lab overdue |
| Advance Not Received | PI advance past due |
| Production Behind | Delay model confidence high |
| Inspection Failed | DUPRO/PSI fail or conditional |
| Booking Cut-off Risk | Cut-off approaching without booking |
| Document Discrepancy | LC vs CI/PL/BL mismatch |
| Vessel Delay / Transhipment | AIS/ETA slip |
| Port Congestion | Destination congestion elevated |
| Demurrage Countdown | Free days burning |
| Balance Payment Overdue | Balance past due |
| BL Not Released | Title docs held |
| Certification Expiring | Supplier cert in 60/30/7 day window |
| Single-Source Dependency | Concentration risk |
| FX Adverse Move | Material FX move on open exposure |

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-RSK-001 | System SHALL detect the risk taxonomy above via rules/analytics | P0 |
| BR-RSK-002 | Risk cards SHALL show predicted impact (days/USD), suggested action, deal link | P0 |
| BR-RSK-003 | Users SHALL be able to acknowledge / dismiss / mitigate with audit | P1 |

#### 7.1.4 Trade Copilot

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-COP-001 | Copilot SHALL answer trade questions with tool-use traces (search deals, retrieve facts, etc.) | P0 |
| BR-COP-002 | Copilot SHALL not invent numeric KPIs; it cites fact packs / stored metrics | P0 |
| BR-COP-003 | Copilot MAY generate artefacts (shortlists, draft PI language, quote comparison summary) for human edit | P1 |

#### 7.1.5 AI grounding (cross-cutting)

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-AI-001 | Metrics SHALL be computed deterministically into fact packs before narration | P0 |
| BR-AI-002 | Every AI narrative/recommendation SHALL support explainability: rationale, fact IDs, confidence, run ID, model, latency | P0 |
| BR-AI-003 | If AI is delayed, metrics UI SHALL still render (degraded banner) | P0 |

---

### 7.2 Deal lifecycle operations

#### 7.2.1 RFQ Inbox & Create

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-RFQ-001 | Support multi-channel intake: email, WhatsApp, portal, EDI | P0 |
| BR-RFQ-002 | AI SHALL extract product, qty, unit, Incoterm, HS suggestion, destination, certs with per-field confidence | P0 |
| BR-RFQ-003 | Ops SHALL triage, assign owner, set priority, link/create deal | P0 |
| BR-RFQ-004 | RFQ Workspace SHALL show matched suppliers and dispatch controls | P0 |

#### 7.2.2 Deal Pipeline & Deal Room

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-DEAL-001 | Pipeline SHALL support kanban (12 stages) and table views with filters | P0 |
| BR-DEAL-002 | Deal Room is the hero workspace: stage tracker, quotes, samples, payments, shipment, docs, comms, timeline, risks, AI panel | P0 |
| BR-DEAL-003 | Quote Comparison Matrix SHALL normalize landed cost across Incoterm, currency, MOQ, lead time, payment terms | P0 |
| BR-DEAL-004 | AI quote recommendation SHALL weight reliability (e.g. OTD) — not always cheapest | P0 |

#### 7.2.3 Samples

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-SMP-001 | Track rounds: golden / counter / pre-production / production / shipment | P0 |
| BR-SMP-002 | Track courier, status, approve/reject with comments and test reports | P0 |

---

### 7.3 Supplier intelligence

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-SUP-001 | Supplier directory with country, category, HS, certification filters | P0 |
| BR-SUP-002 | Supplier 360 scorecard: OTD %, defect rate, price index, quote responsiveness, compliance, overall score, capacity, history | P0 |
| BR-SUP-003 | AI Supplier Discovery: natural-language requirement → ranked shortlist with rationale | P0 |
| BR-SUP-004 | Compliance vault: cert expiry tracking, audit schedule | P0 |
| BR-SUP-005 | Scorecard leaderboard / peer benchmarking | P1 |

---

### 7.4 Orders, production, quality

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-ORD-001 | Manage PI/PO records, payment milestones (advance/balance), amendments | P0 |
| BR-PRD-001 | Production monitor with milestones, progress, WIP notes, delay prediction + confidence | P0 |
| BR-QC-001 | Schedule/record DUPRO and PSI with agency, AQL, sample size, defects, pass/fail/conditional | P0 |
| BR-QC-002 | Support AI-assisted defect review on inspection artefacts (roadmap: photo analysis) | P2 |

---

### 7.5 Logistics

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-LOG-001 | Shipment tracker: BL, vessel, voyage, containers, ETD/ETA/predicted ETA, delay days, status | P0 |
| BR-LOG-002 | Container milestones: gate-in → loaded → sailed → (transhipment) → arrived → discharged → gate-out | P0 |
| BR-LOG-003 | Demurrage free-days countdown and alerts | P0 |
| BR-LOG-004 | Global Trade Map: real world geography, great-circle lanes, vessel positions, port congestion overlays, filters, zoom/pan | P0 |
| BR-LOG-005 | Port congestion board (level 1–5, avg wait days) | P0 |

---

### 7.6 Documents & finance

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-DOC-001 | Document vault for RFQ, Quote, PI, PO, CI, PL, BL/AWB, COO, LC, test/inspection reports, shipping bill, BOE, insurance | P0 |
| BR-DOC-002 | AI field extraction with confidence; discrepancy panel (esp. LC vs CI/PL/BL) | P0 |
| BR-FIN-001 | Payments & cash flow: advance/balance/LC draw status, overdue highlights | P0 |
| BR-FIN-002 | Margin & profitability by deal, supplier, lane, buyer/category | P1 |

---

### 7.7 Automation — Vibrium Flow

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-FLOW-001 | Visual workflow builder with trade-native nodes (see §8.3) | P0 |
| BR-FLOW-002 | Automation library: enable/disable, hours saved, success rate, run history | P0 |
| BR-FLOW-003 | Automation ROI dashboard: hours saved, cycle reduction, error reduction, before/after | P0 |
| BR-FLOW-004 | Unified Comms Hub: email + WhatsApp (+ voice artefacts) per deal; translation; AI-drafted replies pending approval | P0 |
| BR-FLOW-005 | Human-in-the-Loop Approvals queue: approve / edit / reject with rationale retained | P0 |

---

### 7.8 Importer (Buyer) Portal

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-BUY-001 | Buyer home: my requests, orders, arriving shipments, brief | P0 |
| BR-BUY-002 | Raise RFQ (guided / AI-assisted) | P0 |
| BR-BUY-003 | Review & approve quotes | P0 |
| BR-BUY-004 | Order tracker across 12 stages; samples awaiting approval; docs; payments due | P0 |
| BR-BUY-005 | My shipments & documents | P0 |

---

### 7.9 Platform admin

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-ADM-001 | Integrations health: WhatsApp Business, Gmail/Outlook, ERP, carriers (e.g. Maersk/MSC/CMA CGM), customs, inspection agencies, port data | P0 |
| BR-ADM-002 | Configurable SLA thresholds, scoring weights, business rules | P0 |
| BR-ADM-003 | Teams / RBAC / audit log | P0 |
| BR-ADM-004 | Sync freshness and agent run health visible to admins | P1 |

---

## 8. Digital Workers (agents) for automation

Agents are **Digital Workers** — specialized Vibrium agents that understand, decide, and act within policy. Autonomy levels:

| Level | Behaviour |
| --- | --- |
| **Suggest** | Surfaces insight; human acts |
| **Draft** | Prepares message/doc; human sends |
| **Auto with approval** | Prepares action; HITL must approve |
| **Fully auto** | Executes within pre-approved policy envelope |

### 8.1 Agent catalogue

| Agent | Role | Default autonomy | Primary tools | Stage focus |
| --- | --- | --- | --- | --- |
| **Sourcing Scout** | Supplier discovery & shortlist | Auto with approval | portfolio_search, web_research, hs_classify, capacity_check | 1–2 |
| **Quote Analyst** | Landed-cost normalize & rank | Draft | landed_cost, fx_lookup, duty_estimate, otd_history | 4–5 |
| **Supplier Chaser** | Multi-channel follow-up (incl. Mandarin) | Auto with approval | whatsapp_send, email_send, voice_call, translate | 3–4 |
| **Sample Coordinator** | Sample logistics & buyer notify | Draft | courier_track, buyer_notify, lab_schedule | 6, 9 |
| **Production Sentinel** | Delay prediction & escalation | Suggest | wip_ingest, delay_model, capacity_forecast | 8–9 |
| **Inspection Planner** | DUPRO/PSI booking & AQL review | Auto with approval | agency_book, aql_check, photo_analysis | 9–10 |
| **Doc Checker** | OCR extract & LC/doc discrepancy | Draft | ocr_extract, lc_match, discrepancy_detect | 7, 11–12 |
| **Logistics Sentinel** | ETA, congestion, demurrage watch | Suggest | ais_track, port_congestion, demurrage_calc | 11–12 |
| **Payment Steward** | Advance/balance/LC nudges | Auto with approval | payment_status, reminder_send, fx_exposure | 7, 12 |
| **Compliance Guard** | Cert expiry & audit watch | Suggest | cert_vault, expiry_watch, audit_schedule | Continuous |
| **Buyer Concierge** | Importer updates & portal nudges | Draft | portal_notify, brief_generate, translate | Continuous |

### 8.2 Agent requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-AGT-001 | Each agent SHALL expose status, autonomy level, tools, KPIs (hours saved, tasks, success rate), run history | P0 |
| BR-AGT-002 | Outbound customer/supplier communications at Auto-with-approval SHALL enter Approvals queue | P0 |
| BR-AGT-003 | Agent outputs that recommend action SHALL include rationale | P0 |
| BR-AGT-004 | Agents SHALL operate with deal + supplier memory/context (no redundant asks where data exists) | P1 |
| BR-AGT-005 | Voice outreach (where enabled) SHALL use Vibrium Voice patterns with transcripts/summaries available in Hub | P1 |

### 8.3 Trade-native workflow nodes (Vibrium Flow)

Workflows compose agents and channels. Required node types include:

| Node | Purpose |
| --- | --- |
| RFQ Received (trigger) | Intake event |
| Match Suppliers | Invoke Sourcing Scout |
| Dispatch RFQ | Email / WhatsApp / portal |
| Wait / Delay | Time or event wait |
| Condition | e.g. quotes ≥ 3; no reply 72h |
| Chase Supplier (WhatsApp/Voice) | Supplier Chaser |
| AI Compare Quotes | Quote Analyst |
| Notify Buyer | Buyer Concierge / email |
| Generate PI | Document draft |
| Payment Reminder | Payment Steward |
| Document Check | Doc Checker |
| ETA Watch | Logistics Sentinel |
| Escalate to Human | HITL / Approvals |

---

## 9. Standard automation library (Phase 1 pack)

These automations ship as configurable templates:

| Automation | Trigger | Outcome | Typical hours saved / mo* |
| --- | --- | --- | --- |
| RFQ Intake → Match → Dispatch | RFQ received | Parsed RFQ, shortlist, multi-channel dispatch | 120 |
| Silent Supplier Chase | No quote in 72h | WhatsApp then voice chase | 90 |
| Quote Normalize & Rank | Quotes ≥ 3 | Landed-cost rank + buyer notify | 75 |
| Advance Payment Reminder | Advance due −3d | Reminder to buyer/finance | 40 |
| Production Delay Watch | Daily | Escalate if delay confidence > threshold | 110 |
| Document Discrepancy Guard | Doc uploaded | OCR + LC match; flag discrepancies | 95 |
| ETA & Demurrage Sentinel | Shipment sailed | ETA/congestion alerts; free-day burn | 80 |
| Cert Expiry Watch | Daily | 60/30/7 day notifications | 35 |

\*Illustrative from demo baselines; production targets set per client volume.

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-AUT-001 | Client SHALL be able to enable/disable each automation and view run stats | P0 |
| BR-AUT-002 | Client SHALL be able to clone/edit templates in Flow Builder | P1 |

---

## 10. Channels & integrations

| Channel / system | Use |
| --- | --- |
| Email (Gmail/Outlook/SES) | RFQ intake, PI/PO, reminders, docs |
| WhatsApp Business | Supplier chase, status, bilingual templates |
| Voice AI | Chase / confirm when text fails |
| Buyer Portal | Importer self-serve |
| Carrier APIs | Booking/tracking enrichment |
| Port / AIS data | Congestion & vessel progress |
| Inspection agencies | SGS, BV, Intertek, TÜV booking/results |
| ERP (SAP/Tally/etc.) | Orders/finance sync (phased) |
| Identity (SSO) | Corporate IdP SAML/OIDC + MFA |

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-INTG-001 | Integration health SHALL be visible in Admin | P0 |
| BR-INTG-002 | Channel sends SHALL be attributable to deal + agent/user + template version | P0 |

---

## 11. Non-functional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-001 | Performance | Primary dashboards load &lt; 3s with precomputed insights |
| NFR-002 | Freshness | Sync/as-of timestamp on analytical views |
| NFR-003 | Availability | Production target 99.9% |
| NFR-004 | Security | SSO/MFA, RBAC, encryption in transit/at rest, secrets not in client |
| NFR-005 | Audit | User actions, admin changes, agent runs (tokens/model/status) logged |
| NFR-006 | Explainability | AI recommendations include rationale + fact citations |
| NFR-007 | Localization | At minimum EN + ZH for supplier outreach templates; expandable |
| NFR-008 | Scale | Support tens of thousands of deals/docs and concurrent ops users (sized in SATD) |
| NFR-009 | Degraded AI | Metrics remain available if LLM/agent pipeline lags |

---

## 12. Data & AI principles

1. **Compute-then-narrate** — Analytics engines produce facts; agents narrate and recommend.
2. **No invented numbers** — UI and agents must not display KPIs that are not in fact packs / system of record.
3. **Human ownership of irreversible actions** — BL release instructions, large payment releases, and first-contact campaigns default to HITL unless policy explicitly allows auto.
4. **Memory** — Supplier and deal history inform OTD, defect, responsiveness scores used in ranking.
5. **Multi-tenant readiness** — Schema and auth model support tenant isolation for future SaaS commercialization.

---

## 13. Phased delivery roadmap

### Phase 0 — Demo / Discovery (complete for sales)

- Interactive demo UI on Vercel representing all modules below
- Seeded realistic dataset + Demo Director tour
- Used for client visualization and requirement confirmation

### Phase 1 — Production MVP

- Auth (SSO), RBAC, audit basics
- Deal lifecycle + RFQ + suppliers + quotes + samples + PI/PO
- Digital Workers: Scout, Chaser, Quote Analyst, Payment Steward, Doc Checker (core)
- Flow templates: intake/dispatch, chase, quote rank, payment reminder, doc guard
- Command Center + Risk Radar + Approvals + Comms Hub
- Buyer portal (raise RFQ, track order/shipment/docs)
- Email + WhatsApp channels
- Document vault with discrepancy detection

### Phase 2 — Execution depth

- Production Sentinel + Inspection Planner + Logistics Sentinel full loops
- Carrier/AIS/port congestion live feeds
- Global map production data
- Scenario simulator
- Voice chase where licensed
- ERP read/write for orders & payments (scoped)

### Phase 3 — Intelligence depth

- Stronger predictive models (slippage, demurrage probability, win/OTD)
- Compliance Guard maturity + audit workflows
- Conversational analytics expansion
- Manufacturer lightweight portal (optional)
- Autonomous playbooks within approved policy envelopes

---

## 14. Out of scope (initial phases)

- Replacing the client’s ERP as system of record for GL/inventory (integrate, don’t rip-replace)
- Full customs brokerage product
- Training custom foundation models from scratch (use managed LLM + client-specific prompts/RAG)
- Mobile-native apps (responsive web first)
- Guaranteeing carrier/schedule SLAs outside data provider contracts

---

## 15. Success metrics (suggested acceptance)

| Metric | Target (tune per client) |
| --- | --- |
| % RFQs AI-extracted with ≥90% field confidence | ≥ 70% of email/WhatsApp RFQs |
| Median time RFQ → first supplier dispatch | ≤ 4 business hours |
| Quote chase recovery rate (silent → response) | ≥ 40% of chased |
| Avg cycle time reduction vs baseline | ≥ 10–15 days within 2 quarters |
| Open critical risks with no owner &gt; 48h | → 0 |
| Document discrepancies caught before bank presentation | ≥ 95% of flagged |
| Hours automated / month (agent + workflow) | Baseline from ROI dashboard; grow MoM |
| HITL approval median latency | ≤ 4 business hours |

---

## 16. Assumptions & dependencies

| ID | Assumption |
| --- | --- |
| A-01 | Client provides brand, org structure, stage SLAs, and scoring weight preferences |
| A-02 | Client provides supplier portfolio export and historical deal/shipment sample for calibration |
| A-03 | WhatsApp Business and corporate email access granted for integration |
| A-04 | Legal reviews outbound AI templates and autonomy policies |
| A-05 | Demo UI is illustrative; production uses real backends (Vibrium infra: workflows, agents, outreach) |
| A-06 | LLM provider choice (Bedrock / OpenAI / Azure) confirmed in architecture phase |

---

## 17. Screen / capability inventory (demo & product map)

| Area | Capabilities |
| --- | --- |
| Intelligence | Command Center, AI Insights, Scenarios, Risk Radar, Trade Copilot |
| Deals | RFQ Inbox, Create RFQ, RFQ Workspace, Pipeline, Deal Room, Samples |
| Network | Suppliers, AI Discovery, Compliance, Scorecards |
| Execution | Orders, Production, Inspections, Shipments, Trade Map |
| Docs & Finance | Document Vault, Document viewer, Payments, Margins |
| Automation | Automations library, Flow Builder, Digital Workers, Comms Hub, Approvals, ROI |
| Buyer | Home, Raise RFQ, Quotes, Orders, Shipments, Documents |
| Admin | Integrations, Settings (rules, SLA, RBAC, audit) |

---

## 18. Open questions for client workshop

1. Confirm top commodity categories, origin countries, and destination markets for scoring defaults.
2. Confirm preferred deal mode mix (Managed vs Referee) and fee model implications for KPIs.
3. Which systems are SoR today for RFQ, PO, docs, and payments?
4. Autonomy policy: which actions may go fully auto vs always HITL?
5. Languages required beyond EN/ZH for supplier outreach?
6. Data residency / cloud region constraints?
7. White-label branding vs Vibrium Trade brand for production?

---

## 19. Document control

| Version | Date | Author | Notes |
| --- | --- | --- | --- |
| 1.0 | Aug 2026 | Vibrium AI | Initial BRD aligned to Vibrium Trade demo platform |

**Approval**

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Client sponsor | | | |
| Client ops lead | | | |
| Vibrium delivery lead | | | |
