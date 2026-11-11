# Google OAuth verification (so anyone can connect Gmail)

While the Google OAuth app is in **Testing**, only listed test users (max 100) can sign in,
they see an "unverified app" warning, and access expires every 7 days. To let **anyone**
connect Gmail, the app has to be published and verified by Google.

Production URL: **https://vibrium-trade-suite.vercel.app** (pinned in `src/lib/mail/config.ts`
as `PRODUCTION_SITE_URL`).

## What the app already provides

| Google asks for | Where it is |
|---|---|
| Homepage that explains the app and links the privacy policy | `https://vibrium-trade-suite.vercel.app/` (public) |
| Privacy policy with Google user data + Limited Use disclosure | `https://vibrium-trade-suite.vercel.app/privacy` |
| Terms of service | `https://vibrium-trade-suite.vercel.app/terms` |
| Domain ownership proof (Search Console) | `GOOGLE_SITE_VERIFICATION` env → `<meta name="google-site-verification">` |
| OAuth redirect URI | `https://vibrium-trade-suite.vercel.app/api/mail/oauth/google/callback` |

## Steps

### 1. Vercel env (Production)

```
NEXT_PUBLIC_SITE_URL=https://vibrium-trade-suite.vercel.app
NEXT_PUBLIC_LEGAL_CONTACT_EMAIL=<monitored inbox shown on /privacy and /terms>
GOOGLE_SITE_VERIFICATION=<token from step 2>
```

Redeploy after setting them.

### 2. Prove you own the domain

1. [Google Search Console](https://search.google.com/search-console) → Add property → **URL prefix**
   → `https://vibrium-trade-suite.vercel.app/`.
2. Choose **HTML tag**, copy only the `content="…"` value into `GOOGLE_SITE_VERIFICATION`, redeploy,
   click **Verify**.
3. Do this with a Google account that is **Owner or Editor** on the Google Cloud project.

### 3. Google Cloud console → Google Auth Platform

**Branding**
- App name: `Vibrium Trade`, user support email, developer contact email.
- Application home page: `https://vibrium-trade-suite.vercel.app`
- Privacy policy: `https://vibrium-trade-suite.vercel.app/privacy`
- Terms of service: `https://vibrium-trade-suite.vercel.app/terms`
- Authorised domains: `vibrium-trade-suite.vercel.app`
- Logo is optional; adding one triggers brand review (a few extra days).

**Clients → the Web client** → Authorised redirect URIs:
- `https://vibrium-trade-suite.vercel.app/api/mail/oauth/google/callback`
- `http://localhost:3000/api/mail/oauth/google/callback` (dev)

**Audience**
- User type: **External**.
- Publishing status: **Publish app** → *In production*.

**Data access** — scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`.

### 4. Submit for verification

`gmail.readonly` is a **restricted** scope, so the submission needs:

1. **Scope justification** (suggested text):
   > Vibrium Trade reads a user's trade emails and attachments (enquiries, quotes, purchase orders,
   > proforma invoices, shipping documents) and extracts them into a deal book for their
   > buying-agency team. Read-only access to message bodies and attachments is required because the
   > deal details are in the email text and attached PDFs/spreadsheets; metadata-only access cannot
   > see them. The app never sends, modifies or deletes mail.
2. **Demo video** (unlisted YouTube link) showing, in English:
   - the homepage and privacy policy;
   - clicking **Connect Gmail** on `/mailbox/connections`, with the browser address bar visible on
     Google's consent screen so the reviewer can read the `client_id`;
   - the consent screen listing the Gmail scope;
   - the imported emails becoming deals in the app;
   - disconnecting the inbox.
3. **Security assessment (CASA).** After Google approves the scope use, it emails instructions for
   a CASA Tier 2 assessment by an authorised lab. It is paid, takes a few weeks and must be renewed
   every 12 months. Verification is not complete until it passes.

Google usually replies to the submission by email within a few days to a few weeks; answer from
the developer contact address.

## Until verification is done

- **Everyone is on one Google Workspace?** Set Audience → **Internal**. Then every account in that
  Workspace can connect with no verification, no warning screen and no 7-day expiry. Accounts outside
  that Workspace cannot connect.
- **Otherwise** stay in Testing and add each person under Audience → **Test users**.

## Notes

- A custom domain (for example `trade.vibrium.ai`) can make review smoother than a `vercel.app`
  subdomain. If you switch, update `PRODUCTION_SITE_URL`, `NEXT_PUBLIC_SITE_URL`, the redirect URI,
  the authorised domain and Search Console.
- The suite has no login yet (see `EMAIL_CONNECT.md` → Access control). Reviewers and CASA will ask
  how access to stored mail is restricted, so add auth before or during the assessment.
