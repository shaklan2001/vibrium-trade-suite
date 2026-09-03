# Sourcing Process — Buying Agency Model (Ground Truth)

Source artefacts: `docs/wetransfer_sourcing_trading-data_2026-09-01_1406/Sourcing/`  
Primary process deck: `Detailed_Sourcing_Process_Buying_Agency_Model_.pptx` (49 slides, 48 operational steps + outcome)

This document is the **operational ground truth** for automating the first Vibrium Trade workflow (Managed / Buying Agency mode).

---

## 1. Parties

| Role | Who (from real samples) | Typical channels |
|------|-------------------------|------------------|
| **Buyer / Importer** | Loving Pets Corp, Neater Pets / Tower Star Pets LLC, Petrageous Designs, Global Praise | Email |
| **Buying Agency (SNSPL)** | Savvy Net Sourcing — Swinder Juneja, Sanchita Maurya, Kalpana | Email, phone, WhatsApp |
| **Factory / Manufacturer** | Swastik Industries, Y.K. Industries, Barktrunk / V Three Fortunes (Rishi Kalra) | Email, WhatsApp |
| **Forwarder** | Skyline Freight & Travels | Email |
| **Carrier** | CMA CGM (booking confirmation) | Forwarder-mediated |
| **Agency Accounts** | `accounts@snspl.in` | Email + tracking Excel |

**Hub pattern:** Almost every artefact routes through the agency. Factory rarely emails the buyer directly; agency forwards and collects approvals.

---

## 2. End-to-end outcome (Slide 49)

```
REQUIREMENT → DEVELOPMENT → SAMPLE APPROVAL → PO → PRODUCTION →
INSPECTION → PACKING → BOOKING → LOADING → GATE-IN → VESSEL DEPARTURE →
DOCUMENTATION → PAYMENT → COMMISSION → FINAL CLOSURE
```

Payment commercial pattern observed: **T/T against B/L**, often **~30 days after BL shared**, then **container release BL**, then **agency commission** after factory receives buyer payment (FX rate from Accounts).

---

## 3. Phases & 48 steps

### Phase A — Requirement & quote (Steps 1–4)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 1 | Buyer shares initial product requirement | Buyer → Agency | Email enquiry (product category, target retail/cost, feasibility) |
| 2 | Agency approaches suitable factories | Agency → Factory | Outreach email / WhatsApp |
| 3 | Factory provides initial quote sheet | Factory → Agency | **AS / Quote sheet** (Excel with SKUs, photos, prices) |
| 4 | Buyer reviews and selects products | Agency → Buyer → Agency | Annotated quote / selection email |

**Sample files:** `AS LEATHER TOYS 6.3.25.xlsx`  
**PPT evidence:** Petrageous → SNSPL leather toys enquiry; factory quote with product photos.

---

### Phase B — Artwork & development samples (Steps 5–12)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 5 | Buyer shares AI artwork / design files | Buyer → Agency | AI / design files, packaging artwork |
| 6 | Factory shares AI artwork with agency | Factory → Agency | Artwork for buyer approval |
| 7 | Agency forwards artwork for buyer final approval | Agency → Buyer | Forwarded artwork pack |
| 8 | Factory develops initial samples to finalize costing | Factory | Sample development |
| 9–10 | Agency requests samples; factory dispatches + shares pictures | Agency ↔ Factory → Buyer | Physical samples + WhatsApp/email photos |
| 11 | Factory confirms final cost / packaging after development | Factory → Agency | Updated costing / packing details |
| 12 | Testing & compliance requirement confirmation | Buyer ↔ Agency ↔ Factory | Test/compliance checklist confirmation |

**Sample files:** `NP_neatermat_6x4_INDIA.pdf`, `NP_neatlikEXPRESS_funlickmat_5x7_28082025.pdf` (buyer packaging / insert artwork)

---

### Phase C — PI / PO commercial lock (Steps 13–16)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 13 | Factory prepares final **PI** (qty + packing) | Factory → Agency | Proforma Invoice (PDF + XLSX) |
| 14 | Agency shares factory PI with buyer | Agency → Buyer | Forwarded PI |
| 15 | Buyer issues **PO** | Buyer → Agency | PO PDF + item/UPC Excel; load date / ETA notes |
| 16 | Agency shares PO with factory | Agency → Factory | Forwarded PO |

**Sample files:**

| File | Type | Deal signal |
|------|------|-------------|
| `090 Performa Invoice-LP-14682.xls` | Factory PI | Swastik → Loving Pets; PO 14682; FOB India; Mundra→NY; T/T against B/L |
| `PO# 14682 Swastik 9-1-2026.xlsx` | Buyer PO line sheet | Ship date, item#, inner/master, CBM, cases, unit cost |
| `Pet rageous PI -17-27.02.2026.xlsx` / `PI -18` | Factory PI | Y.K. Industries → Global Praise |
| PPT: Neater Pets PO **20958** email | Buyer PO | 19,500 units; load 9/19; ETA 11/8; clubbing question |

**Key commercial fields to extract:** PO#, PI#, shipper, consignee, Incoterm, payment terms, port pair, ready date, SKU lines (item#, desc, IC/MC, pcs, unit FOB, CTN, CBM).

---

### Phase D — Spec, barcode & packaging approvals (Steps 17–28)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 17–18 | Buyer reviews initial physical samples; factory reverts | Buyer ↔ Factory (via Agency) | Sample feedback emails |
| 19–20 | Buyer shares product spec / packaging / artwork; agency to factory | Buyer → Agency → Factory | Spec PPT, packaging templates, inserts |
| 21–24 | Barcode artwork loop (submit → agency → buyer approve → factory) | Factory ↔ Agency ↔ Buyer | Barcode JPG/DOCX; UPC master Excel |
| 25–28 | Final packaging change confirmation loop (often WhatsApp photos → agency PPT → buyer) | Factory ↔ Agency ↔ Buyer | Packaging photos PDF/PPT |

**Sample files:**

| File | Role |
|------|------|
| `Neater Mat Specs - PO # 20719.pptx` | Product/packaging spec by size (material, weight, master pack, barcode notes) |
| `Neater Mats Item Number & UPC.xlsx` | UPC ↔ item# master |
| `Neat-Lik Express Items & UPCs.xlsx` | UPC master for PO 20958 |
| `Barcode Label - Neater Mats.docx` | Label layout (item#, PO#, Made in India) |
| `BARCODES FINAL - NEATLICK MAT- SMALL.jpg` | Barcode artwork for approval |
| `Master Carton Box Template - Neater Mats.docx` | Master carton artwork template |
| `PACKAGING PO-20958.pdf` | Final packaging photo pack |

**Automation note:** Steps 21–28 are **approval gates** with multi-party ping-pong. High value for status tracking + reminder SLAs.

---

### Phase E — Production, PP sample, inspection (Steps 29–34)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 29 | Agency production follow-ups | Agency → Factory | Email / call / WhatsApp status |
| 30–32 | Pre-production (PP) sample request → dispatch → buyer revert | Agency ↔ Factory → Buyer | Courier tracking + PP feedback |
| 33–34 | Final dispatch + inspection plan; QC briefed with approved artworks/packaging | Agency ↔ Factory (+ QC team) | Inspection plan; approved artwork pack |

**Sample files:** `Inspection pictures Po-20719.pdf` (item-level photo evidence for PO 20719)

---

### Phase F — Booking & sailing (Steps 35–38)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 35 | Factory initiates booking via forwarder | Factory → Forwarder | Booking request |
| 36 | Forwarder confirms vessel options | Forwarder → Factory (+ Agency CC) | Sailing schedule options (vessel, ETD, ETA) |
| 37 | Factory accepts vessel schedule | Factory → Forwarder | Acceptance |
| 38 | Final booking + draft BL → factory approve → OBL | Forwarder ↔ Factory | **Booking confirmation**, draft BL, final OBL, charges |

**Sample files:**

| File | Role |
|------|------|
| `BKGCONF_EID0949971.pdf` | CMA CGM booking: EID0949971; Mundra→NY; APL LE HAVRE; ETD 27-MAY-2026; ETA 30-JUN-2026; 1×40'HC; forwarder Skyline |
| `CBM SHEET -TOYS FINAL QTY - YK .xlsx` | Container fill / CBM planning (40FT) |
| `SWASTIK SURRENDER(SFTL05271149).pdf` | Surrender / shipping-related PDF |

---

### Phase G — Final docs, payment, release, commission (Steps 39–48)

| # | Step | From → To | Artefacts |
|---|------|-----------|-----------|
| 39 | Factory shares final docs with agency | Factory → Agency | Commercial Invoice, Packing List, OBL, sailing/ETA |
| 40 | Agency shares final docs with buyer | Agency → Buyer | Same set forwarded |
| 41 | Buyer pays (~30 days after BL); shares payment receipt for release | Buyer → Agency | Payment advice / receipt |
| 42 | Agency informs factory of payment + release | Agency → Factory | Confirmation |
| 43–44 | Factory shares **release BL**; agency to buyer | Factory → Agency → Buyer | Release / telex release BL |
| 45 | Agency shares payment tracking with Accounts | Ops → Accounts | Tracking report Excel (multi-market) |
| 46 | Accounts sends FX rate to factory for commission invoice | Accounts → Factory | Exchange rate |
| 47 | Factory shares payment advice (of commission / buyer remittance) | Factory → Agency | Payment advice |
| 48 | Agency verifies bank credit; confirms to factory | Accounts → Agency → Factory | Bank confirmation |

**Sample files:** `P L V3F 26 27 E 002.pdf` — Packing List (V Three Fortunes → Neater Pets; buyer orders 20958 / 21527 / 21336; Nhava Sheva → NY / Chicago)

---

## 4. Document taxonomy (for Document Vault)

| Doc type | When created | Owner | Example in pack |
|----------|--------------|-------|-----------------|
| Requirement / RFQ email | Step 1 | Buyer | PPT slide 2 |
| AS / Quote sheet | Step 3 | Factory | `AS LEATHER TOYS 6.3.25.xlsx` |
| Artwork / AI files | Steps 5–7 | Buyer / Factory | `NP_*.pdf` inserts |
| Product spec pack | Steps 19–20 | Buyer | `Neater Mat Specs - PO # 20719.pptx` |
| Proforma Invoice (PI) | Steps 13–14 | Factory | `090 Performa Invoice-LP-14682.xls`, Petrageous PIs |
| Purchase Order (PO) | Steps 15–16 | Buyer | `PO# 14682…xlsx`, PPT PO 20958 |
| UPC / Item master | Steps 15, 21 | Buyer | `Neater Mats Item Number & UPC.xlsx` |
| Barcode artwork | Steps 21–24 | Factory | `BARCODES FINAL…jpg`, barcode DOCX |
| Master carton template | Steps 19–28 | Buyer / Factory | `Master Carton Box Template…docx` |
| Packaging photo pack | Steps 25–28 | Factory | `PACKAGING PO-20958.pdf` |
| Inspection photo pack | Steps 33–34 | Agency QC / Factory | `Inspection pictures Po-20719.pdf` |
| CBM / container sheet | Steps 34–35 | Factory / Agency | `CBM SHEET -TOYS…xlsx` |
| Booking confirmation | Steps 36–38 | Carrier via Forwarder | `BKGCONF_EID0949971.pdf` |
| Packing List (PL) | Step 39 | Factory | `P L V3F 26 27 E 002.pdf` |
| Commercial Invoice (CI) | Step 39 | Factory | Referenced in PPT (attached to final docs email) |
| Bill of Lading / OBL | Steps 38–40 | Carrier | Referenced (`ORIGINAL BL.pdf` in PPT) |
| Release BL | Steps 43–44 | Factory / Carrier | Referenced in PPT |
| Payment advice / receipt | Steps 41, 47 | Buyer / Factory | Referenced in PPT |
| Payment tracking report | Step 45 | Agency Ops | PPT: `TRACKING REPORT (LP UK, US AUST.xlsx` |
| Commission invoice | Steps 46–48 | Factory ← Agency FX | Referenced in PPT |

---

## 5. Observed deal threads in this pack

These are **parallel real deals** illustrating the same process:

1. **Loving Pets × Swastik** — Bella Bowls; PO/PI **14682**; Mundra→NY; FOB; T/T against B/L; booking EID0949971 pattern.
2. **Neater Pets × Barktrunk / V Three Fortunes** — Neater Mat / Neat-Lik Express; POs **20719**, **20958** (+ clubbed 21527, 21336); barcode + packaging + inspection + PL.
3. **Petrageous / Global Praise × Y.K. Industries** — Leather toys; AS sheet → samples → PI-17/PI-18; CBM sheet for 40FT.

---

## 6. Automation implications (first workflow)

### Control points (human approval required)

1. Quote selection (buyer)
2. Artwork final approval (buyer)
3. PI acceptance / PO issue (buyer)
4. Barcode approval (buyer)
5. Final packaging approval (buyer)
6. PP sample acceptance (buyer)
7. Inspection pass (agency QC)
8. Vessel / booking acceptance (factory, agency visibility)
9. Draft BL approval (factory)
10. Payment confirmation / release (buyer → agency → factory)
11. Commission FX + bank verify (accounts)

### High-ROI automations for v1 sourcing flow

| Automation | Trigger | Action |
|------------|---------|--------|
| RFQ / requirement intake | Buyer email | Extract product, target cost, destination; create deal |
| Quote normalize | AS sheet upload | Parse SKUs/prices into quote matrix |
| PI ↔ PO discrepancy check | PI + PO received | Match item#, qty, price, CBM, Incoterm, ports |
| Approval chase | Open barcode/packaging/sample gate | Reminder SLA on WhatsApp/email |
| Production follow-up cadence | PO acknowledged | Scheduled chase until ready date |
| Booking / sailing extract | Booking PDF or forwarder email | Capture booking#, vessel, ETD/ETA, equipment |
| Final docs pack check | CI + PL + BL | Completeness + field cross-check vs PO |
| Payment / release tracker | BL shared date | 30-day payment clock; release BL routing |
| Commission close | Buyer payment + FX from accounts | Commission invoice checklist |

### Channels that must be modeled

- **Email** (primary system of record for formal docs)
- **WhatsApp** (sample photos, packaging changes, informal chase)
- **Phone/call** (inspection plan confirmation — often no artefact)
- **Excel trackers** (ops → accounts payment tracking)

---

## 7. Suggested workflow stages for the product

Map the 48 steps into product pipeline stages (aligns with BRD + this pack):

| Stage ID | Name | PPT steps |
|----------|------|-----------|
| S1 | Requirement intake | 1 |
| S2 | Factory outreach & quote | 2–4 |
| S3 | Development & artwork | 5–12 |
| S4 | PI & PO | 13–16 |
| S5 | Spec / barcode / packaging lock | 17–28 |
| S6 | Production & PP sample | 29–32 |
| S7 | Inspection & ready | 33–34 |
| S8 | Booking & sailing | 35–38 |
| S9 | Final documentation | 39–40 |
| S10 | Payment & BL release | 41–44 |
| S11 | Commission & closure | 45–48 |

---

## 8. Source inventory checklist

All files under `Sourcing/` reviewed:

- [x] `Detailed_Sourcing_Process_Buying_Agency_Model_.pptx` (48-step flow + email screenshots)
- [x] Quote / AS: `AS LEATHER TOYS 6.3.25.xlsx`
- [x] PIs: `090 Performa Invoice-LP-14682.xls`, Petrageous PI-17/18
- [x] PO line sheet: `PO# 14682 Swastik 9-1-2026.xlsx`
- [x] UPC masters + barcode label/artwork
- [x] Specs PPT + packaging artwork PDFs + packaging photo PDF
- [x] Inspection pictures PDF
- [x] CBM sheet
- [x] Booking confirmation PDF
- [x] Packing list PDF
- [x] Surrender PDF (present; limited extractable text)
