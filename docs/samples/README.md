# Client sample artefacts overview

Three packs from the client WeTransfer dump, curated for automation design.

## 1. Sourcing (primary — buying agency)

Path: [`Sourcing/`](./Sourcing/) · see [`Sourcing/INVENTORY.md`](./Sourcing/INVENTORY.md)

Contains the **Detailed Sourcing Process** PPT (49 slides / 48 steps) plus real artefacts for Neater Pets, Loving Pets, Petrageous / Y.K., Swastik deals: quotes, PIs, POs, UPCs, barcodes, packaging, inspection, CBM, booking, packing list.

**Use for:** Phase A–G sourcing automation.

## 2. Trading_V1

Path: [`Trading_V1/`](./Trading_V1/) · [`INVENTORY.md`](./Trading_V1/INVENTORY.md)

PPT-labelled shipment artefacts: POs, PDI, inspection, booking, custom invoice, draft/final BL, shipping bill, factory invoice/pack.

**Use for:** later trading-mode workflows (principal trading, not only buying-agency).

## 3. Trading Vendor Registration

Path: [`Trading_Vendor_Registration/`](./Trading_Vendor_Registration/) · [`INVENTORY.md`](./Trading_Vendor_Registration/INVENTORY.md)

Slide-wise vendor onboarding / quote / PO / artwork / shipment / commission files (`SLIED NO-*`, `MAILS.pptx`, Savvy Net PDF). Large **zip** archives are not in git — see [`ZIP_ARCHIVES_NOT_COPIED.md`](./Trading_Vendor_Registration/ZIP_ARCHIVES_NOT_COPIED.md).

## Fixtures for the running app

[`../fixtures/`](../fixtures/) — currently `AS LEATHER TOYS 6.3.25.xlsx` for Quotes upload demos.

## Deal threads observed in Sourcing

1. **Loving Pets × Swastik** — Bella Bowls; PO/PI 14682; Mundra→NY; FOB; T/T vs B/L; booking EID0949971 pattern  
2. **Neater Pets × Barktrunk / V Three Fortunes** — mats; POs 20719 / 20958; barcodes, packaging, inspection, PL  
3. **Petrageous / Global Praise × Y.K.** — leather toys; AS sheet → samples → PI-17/18; CBM 40FT  

Commercial pattern: **FOB India**, **T/T against B/L**, payment often **~30 days after BL**, then release BL, then agency commission (FX from Accounts).
