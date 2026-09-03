# Related repositories

Use these as reference implementations — do not merge their UIs into Trade.

| Repo | Absolute path | Why it matters |
|------|---------------|----------------|
| **This product** | `/Users/piyushjha/Documents/personal/vibrium-trade-suite` | Continue all Trade work here |
| Vibrium platform | `/Users/piyushjha/Documents/personal/tech-vibrium` | Backend APIs, Quantum UI, workflow runtime |
| HR Suite demo | `/Users/piyushjha/Documents/personal/HR_Workflow` | Modular SPA + bot routing + pollUntil + token BFF |
| Payment / Voyager | `/Users/piyushjha/Documents/personal/payment_automation` | Next.js Vercel chat proxy pattern |
| Legacy demo | `/Users/piyushjha/Documents/personal/export_automation` | **Obsolete UI**; docs/samples already copied here |

## Env credential sources

Copy service username/password / customer id from:

- `HR_Workflow/.env.local`
- `payment_automation/.env.local`

Never commit secrets. Vercel project already has staging env for Trade.

## Original WeTransfer pack (if you need excluded zips)

```
/Users/piyushjha/Documents/personal/export_automation/docs/wetransfer_sourcing_trading-data_2026-09-01_1406/
  Sourcing/                          → copied to docs/samples/Sourcing
  Trading_V1/                        → copied to docs/samples/Trading_V1
  Trading(Vendor Registration)/      → non-zip copied; zips listed in ZIP_ARCHIVES_NOT_COPIED.md
```
