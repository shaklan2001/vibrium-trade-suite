# Phases B → G — build guide (sequential)

Ground truth: [Sourcing-Buying-Agency-Process-Map.md](../Sourcing-Buying-Agency-Process-Map.md)  
Samples: [samples/Sourcing/](../samples/Sourcing/) (+ Trading packs for later trading mode)

For each phase: **worker schema → conversational chase → UI module → routing slot → RUNBOOK IDs**.

---

## Phase B — Artwork & development samples (PPT 5–12)

### Process

Buyer AI/design → factory artwork → agency forward → approval → initial samples → costing → compliance confirmation.

### Sample files

| File | Role |
|------|------|
| `NP_neatermat_6x4_INDIA.pdf` | Packaging / insert artwork |
| `NP_neatlikEXPRESS_funlickmat_5x7_28082025.pdf` | Artwork |
| `Neater Mat Specs - PO # 20719.pptx` | Spec pack (also used in D) |
| PPT slides 5–12 screenshots in process PPT | Email patterns |

### Suggested workers

| Slot | Job |
|------|-----|
| `artwork_checklist_extractor` | List required artwork assets + approval status from email/PDF |
| `sample_request_summarizer` | Extract sample courier / photo refs |

### Conversational

| Slot | Job | Dispositions |
|------|-----|--------------|
| `artwork_approval_chase` | Nudge buyer/factory on pending artwork | `Approved`, `ChangesRequested`, `EscalateToHuman` |
| `sample_dispatch_chase` | Confirm sample shipped / received | `Shipped`, `Received`, `Delayed`, `EscalateToHuman` |

### UI

- Deal stage `artwork` / `samples`
- Artwork checklist panel + sample timeline
- Document types: `artwork`, `sample_photo`

---

## Phase C — PI & PO lock (PPT 13–16)

### Process

Factory PI → agency → buyer → buyer PO → agency → factory.

### Sample files

| File | Role |
|------|------|
| `090 Performa Invoice-LP-14682.xls` | Factory PI (Swastik → Loving Pets) |
| `PO# 14682 Swastik 9-1-2026.xlsx` | Buyer PO lines |
| `Pet rageous PI -17-27.02.2026.xlsx` / `PI -18` | Y.K. PIs |
| PPT: Neater PO 20958 email | PO + UPC attachment pattern |

### Suggested workers

| Slot | Job |
|------|-----|
| `pi_extractor` | Parse PI → shipper, consignee, Incoterm, ports, lines, CBM, payment terms |
| `po_extractor` | Parse PO → same commercial fields |
| `pi_po_discrepancy` | Diff PI vs PO (qty, price, CBM, Incoterm, ports, SKU) |

### Conversational

| Slot | Dispositions |
|------|--------------|
| `po_ack_chase` | `Acknowledged`, `Mismatch`, `EscalateToHuman` |

### UI

- Stage `pi_po`
- Side-by-side PI/PO field compare with confidence chips
- High-ROI demo after Phase A

---

## Phase D — Spec / barcode / packaging approvals (PPT 17–28)

### Process

Sample feedback → specs → barcode artwork loop → packaging photo approval (WhatsApp → PPT → buyer).

### Sample files

| File | Role |
|------|------|
| `Neater Mat Specs - PO # 20719.pptx` | Specs |
| `Neater Mats Item Number & UPC.xlsx` | UPC master |
| `Neat-Lik Express Items & UPCs.xlsx` | UPC for PO 20958 |
| `Barcode Label - Neater Mats.docx` | Label layout |
| `BARCODES FINAL - NEATLICK MAT- SMALL.jpg` | Barcode art |
| `Master Carton Box Template - Neater Mats.docx` | Carton template |
| `PACKAGING PO-20958.pdf` | Packaging photos |

### Suggested workers

| Slot | Job |
|------|-----|
| `upc_barcode_matcher` | Match barcode art to UPC master / PO items |
| `packaging_photo_checklist` | Confirm required pack views present |

### Conversational

Approval chase loops (barcode / packaging) with SLA reminders — highest ping-pong value.

### UI

- Stage `packaging`
- Approval gate board (pending / approved / rejected) per artefact type

---

## Phase E — Production, PP sample, inspection (PPT 29–34)

### Sample files

| File | Role |
|------|------|
| `Inspection pictures Po-20719.pdf` | Inspection photo pack |

### Suggested workers

| Slot | Job |
|------|-----|
| `inspection_photo_summarizer` | Item-level pass/fail notes from PDF/images |
| `production_status_extractor` | Parse factory status emails |

### Conversational

| Slot | Job |
|------|-----|
| `production_followup` | Cadence chase until ready date |
| `pp_sample_chase` | PP sample dispatch / buyer revert |

### UI

- Stage `production`
- Inspection gallery + QC checklist tied to approved artwork pack

---

## Phase F — Booking & sailing (PPT 35–38)

### Sample files

| File | Role |
|------|------|
| `BKGCONF_EID0949971.pdf` | CMA CGM booking (Mundra→NY, vessel, ETD/ETA, 40'HC) |
| `CBM SHEET -TOYS FINAL QTY - YK .xlsx` | Container fill |
| `SWASTIK SURRENDER(SFTL05271149).pdf` | Surrender-related |
| PPT forwarder emails (Skyline) | Vessel option tables |

### Suggested workers

| Slot | Job |
|------|-----|
| `booking_extractor` | booking#, vessel, voyage, POL/POD, ETD/ETA, equipment, cut-offs |
| `cbm_container_planner` | Parse CBM sheet → total CBM / container fit |

### Conversational

| Slot | Job |
|------|-----|
| `sailing_confirm` | Confirm vessel option with factory |

### UI

- Stage `booking`
- Booking card + sailing options compare

---

## Phase G — Final docs, payment, release, commission (PPT 39–48)

### Sample files

| File | Role |
|------|------|
| `P L V3F 26 27 E 002.pdf` | Packing list |
| PPT final docs / payment / tracking emails | CI, OBL, release BL, FX, commission |
| Trading packs | Extra BL/invoice examples in `Trading_V1/` |

### Suggested workers

| Slot | Job |
|------|-----|
| `final_docs_pack_check` | Completeness CI+PL+BL vs PO |
| `payment_clock` | BL shared date → +30 days T/T reminder state |
| `commission_checklist` | FX from accounts + payment advice verify |

### Conversational

Payment / release reminders to buyer and factory; accounts nudge.

### UI

- Stage `docs_payment` → `closed`
- Docs pack checklist + payment timeline + commission close

---

## Trading mode (later)

After sourcing Phase A–G is solid, use:

- `samples/Trading_V1/` — BL drafts, factory invoice/pack, inspection, booking PDFs
- `samples/Trading_Vendor_Registration/` — quote→PO→artwork→shipment→commission slide sequence (`MAILS.pptx`, SLIED NO-* files)

Vendor zip archives are **not** in git; see `Trading_Vendor_Registration/ZIP_ARCHIVES_NOT_COPIED.md` for local paths on the original WeTransfer folder.
