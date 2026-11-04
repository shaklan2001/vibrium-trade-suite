# Email connections (live mailbox sync)

Connect a **Gmail / Google Workspace** inbox at **`/mailbox/connections`**. Outlook and IMAP
are also built in, behind "Other providers". New mail is pulled automatically and runs through
the **same pipeline as the PST upload**, so deals land in `processed_deals` and show up in
Mailbox book, Deal Board, Operations and Copilot without any other change.

```
Gmail ──(Sync now | auto-sync while the suite is open | daily cron | optional push)──▶ /api/mail/*
  │  list since cursor → dedupe → fetch raw MIME → parse (mailparser)
  │  noise filter → thread into deal_key (In-Reply-To / PO / BKG / topic)
  │  attachments → S3 trade/pst-ingest/{sha256}/{file}
  ▼
mail_messages ──▶ mail_deal_jobs (dirty) ──▶ deal pack (+ PST history for same id)
  ──▶ relevance gate ──▶ choose_slot / pick_document ──▶ Vibrium worker (agent-executions)
  ──▶ processed_deals (same row shape as scripts/pst-extract/process_deals.py)
```

| PST script (Python) | Live mail (TypeScript) |
|---|---|
| `cluster_threads.py` noise / party_role / stage_of / po_key | `src/lib/mail/classify.ts` |
| `build_relevant_deals.py` deal pack + is_relevant | `src/lib/mail/dealPack.ts`, `classify.isRelevantDeal` |
| `process_deals.py` choose_slot / payload / evidence / cost | `classify.ts`, `sync.ts`, `workers.ts` |

**Keep the two in step.** If you change a domain list or regex in one, change the other.

## Where the data lives (and "the Lambda")

The app already reads the deal book from one of two places. Mail sync uses the same one:

| `TRADE_SUITE_DB_MODE` | Storage | What to do for mail |
|---|---|---|
| `rds-proxy` (the deployed suite) | Aurora schema `trade_suite`, reached through the **existing** VPC Lambda `trade-suite-rds-proxy`. Source: `infra/trade-suite-rds-proxy/handler.py`, deploy script `deploy.sh`, called from `src/lib/rdsProxy.ts`. | The mail actions (`mail_*`) were added to that same handler. **Redeploy it once:** `DB_PASSWORD=… infra/trade-suite-rds-proxy/deploy.sh` (needs the AWS CLI for account 173961275780). This updates the code and runs `migrate`, which creates the mail tables. |
| unset + `DATABASE_URL` | Neon Postgres | Nothing. Mail tables are created on first use. Easiest for a POC or local dev. |

No new Lambda was created.

## Free tier (Vercel Hobby)

Hobby limits functions to **60 s** and cron to **once a day**, so sync is built in small chunks:

- **Sync now.** Buttons on *Mailbox book* and *Email connections*. Each call does about 48 s of work (`MAIL_REQUEST_BUDGET_S`), and the browser keeps calling until every inbox is caught up. A large first import (for example 90 days) simply takes several rounds, with live progress in the toast.
- **Auto-sync while the suite is open.** Every open tab pings `/api/mail/sync` every 3 minutes. The server skips inboxes synced in the last 2 minutes and uses a per-inbox lock, so many tabs are harmless.
- **Daily Vercel cron.** `vercel.json` runs `/api/mail/cron` at 06:00 UTC to catch up when nobody has the app open.
- *Optional, free, near-real-time without the app open:*
  - **A free pinger.** [cron-job.org](https://cron-job.org) or UptimeRobot calls `GET https://<site>/api/mail/cron?token=<CRON_SECRET>` every 5 minutes.
  - **Gmail push.** Google Pub/Sub has a free tier; see step 3.5 below.
- Local dev: `npm run mail:sync` loops the cron endpoint every 2 minutes.

Worker agents run asynchronously. A deal started in one call is picked up and saved by the next sync, auto-sync or page poll.

## Behaviour

- **Read-only.** Gmail `gmail.readonly` (Graph `Mail.Read` and IMAP read-only for the other providers).
- **Credentials** are AES-256-GCM encrypted with `MAIL_ENCRYPTION_KEY` and never sent to the browser.
- **History:** the first sync imports the last N days (picked on connect, default 30). Raising it later re-lists the wider window. Stored IDs dedupe.
- **Threading:** a reply joins its parent's deal across every connected inbox. If the PST book already has `po:8615`, new mail on PO 8615 is merged into that deal's evidence and the worker re-runs on the combined thread.
- **Safety:** a failed or skipped re-run never replaces a completed deal. The old result stays and only the evidence is refreshed.
- **Relevance:** *Known parties* uses the PST rules (buyer/factory/forwarder domains, POs, freight). *Any trade thread* sends anything with a trade signal to the worker and lets its `isTradeDeal` gate decide. For other companies' domains, add them via `MAIL_EXTRA_*_DOMAINS`.
- **Disconnect** stops push, revokes the Google grant and deletes stored raw mail. Deals stay in the book.

## Setup

### 1. Environment (`.env.local` / Vercel)

```
MAIL_ENCRYPTION_KEY=   # openssl rand -base64 32   (required; don't rotate without re-connecting)
CRON_SECRET=           # openssl rand -hex 24      (cron, free pinger, push webhooks)
MAIL_WORKSPACE_DOMAIN=snspl.in
NEXT_PUBLIC_SITE_URL=https://vibrium-trade-suite.vercel.app
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

The suite's existing DB, `VIBRIUM_*` and `AWS_S3_BUCKET` settings are reused.

### 2. Database

See *Where the data lives* above: redeploy the Lambda (Aurora) or do nothing (Neon).

### 3. Google: our Workspace and accounts outside it

1. Google Cloud console (any project, ideally under our Workspace org) → APIs & Services → enable the **Gmail API**.
2. **OAuth consent screen → User type: _External_.** This is required for accounts outside our Workspace (personal Gmail, buyers' or factories' Workspaces). *Internal* only allows `@MAIL_WORKSPACE_DOMAIN` accounts.
   - Add the scopes `openid`, `email`, `profile` and `.../auth/gmail.readonly`.
   - **Publishing status: Testing** is fine for the POC. Add every outside person under **Test users** (up to 100). Users from our own Workspace also need to be listed while in Testing.
   - In Testing, Google shows an "unverified app" screen. Click *Continue*. Google also **expires access after 7 days**; the inbox then shows *reconnect needed*, and one click on **Reconnect** fixes it.
   - For production, submit for verification. `gmail.readonly` is a restricted scope and needs Google's security assessment. That removes the 7-day expiry, the test-user list and the warning screen.
3. Credentials → **OAuth client ID → Web application**. Authorised redirect URIs:
   - `https://vibrium-trade-suite.vercel.app/api/mail/oauth/google/callback`
   - `http://localhost:3000/api/mail/oauth/google/callback` (and :3001 if dev runs there)
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. *Optional push:* create a Pub/Sub topic and grant `gmail-api-push@system.gserviceaccount.com` the **Publisher** role. Add a push subscription to `https://<site>/api/mail/webhooks/google?token=<CRON_SECRET>`. Set `GOOGLE_PUBSUB_TOPIC=projects/<p>/topics/<t>`.

**If a company account is blocked:** some Workspaces (ours or a partner's) block unverified third-party apps. The user then sees *"admin_policy_enforced"* / *"Access blocked"*. That Workspace's admin allows it under **Admin console → Security → API controls → App access control → Add app → OAuth client ID → Trusted**.

The connections list labels each account as **our Workspace**, **outside Workspace (domain)** or **Personal Gmail**. Mail from the connected address, and from its company domain unless it's a public domain like gmail.com, is treated as *internal* when classifying parties.

### 4. Outlook / IMAP (optional, later)

- **Outlook:** create an Entra app registration with redirect `{site}/api/mail/oauth/microsoft/callback` and delegated permissions `Mail.Read`, `User.Read` and `offline_access`. Then set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and `MICROSOFT_TENANT_ID`.
- **IMAP:** no setup. Users enter host, login and an app password.

## Limits & tuning

| Env | Default | |
|---|---|---|
| `MAIL_REQUEST_BUDGET_S` | 48 | seconds of work per request (stay under the 60 s limit) |
| `MAIL_MESSAGES_PER_RUN` | 150 | messages fetched per inbox per request |
| `MAIL_JOBS_PER_RUN` | 10 | worker executions started per request |
| `MAIL_DEFAULT_BACKFILL_DAYS` | 30 | |

- Listing is capped at 2,000 messages per sync window. A larger first import shows a warning, so lower the history days.
- Each new email on a deal re-runs one worker on that deal (about $0.01–0.03 with gpt-4.1).

## Access control

POC: the suite has no login, so anyone with the URL can connect or disconnect inboxes and see deals. This is intentional for now. **Auth0** will be added for production; put `/api/mail/*` and `/mailbox/*` behind it at that point.
