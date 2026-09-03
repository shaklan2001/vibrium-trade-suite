# Project context snapshot (for humans & coding agents)

## Product

**Vibrium Trade — Sourcing Suite**: buying-agency export automation using **existing Vibrium worker + conversational agents**, no new Trade domain APIs (for now).

## Locked decisions

1. Existing Vibrium APIs only  
2. Sequential phases starting at **Phase A** (requirement → quote → selection)  
3. Channels: email + WhatsApp + voice as needed  
4. New repo `vibrium-trade-suite` + **Vercel** deploy  
5. Existing Vibrium org / creds from HR & payment automations  
6. Discard `export_automation` demo UI  

## Shipped

- App: https://vibrium-trade-suite.vercel.app  
- Workers: AA00000025, AA00000026  
- Docs pack under `docs/` (this tree)

## Next

Phase B (artwork & samples) per `docs/phases/PHASES_B_TO_G.md`.

## Read order for a new session

1. `docs/README.md`  
2. `docs/CONTINUATION_GUIDE.md`  
3. `docs/architecture/ARCHITECTURE.md`  
4. Phase doc you are building  
5. Open matching files in `docs/samples/Sourcing/`
