"""
Calls the app's mail cycle on a schedule (EventBridge, every 5 minutes).

Vercel Hobby only allows daily crons, so this Lambda does the frequent run:
  GET {APP_URL}/api/mail/cron      Authorization: Bearer {CRON_SECRET}

Env: APP_URL (e.g. https://vibrium-trade-suite.vercel.app), CRON_SECRET.
The secret goes in the header, never the URL, so it stays out of access logs.
Standard library only; the function runs outside the VPC (it only needs the internet).
"""
import json
import os
import urllib.error
import urllib.request

TIMEOUT_S = 70  # the route allows up to 60 s of work


def lambda_handler(event, context):
    base = os.environ.get("APP_URL", "").rstrip("/")
    secret = os.environ.get("CRON_SECRET", "")
    if not base or not secret:
        raise RuntimeError("APP_URL and CRON_SECRET must be set")
    req = urllib.request.Request(
        f"{base}/api/mail/cron",
        headers={"Authorization": f"Bearer {secret}", "User-Agent": "trade-suite-mail-cron/1"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            body = res.read().decode("utf-8", "replace")
            status = res.status
    except urllib.error.HTTPError as err:
        # A non-2xx is a failed run: raise so it shows in the function's error metric.
        raise RuntimeError(f"mail cron returned {err.code}: {err.read().decode('utf-8', 'replace')[:300]}")
    try:
        summary = json.loads(body)
        # Counts only, never mail content.
        keep = {k: v for k, v in summary.items() if isinstance(v, (int, float, str, bool)) or k in ("job_counts", "payments", "documents", "ocr", "jobs", "signals", "nextActions", "statements")}
    except ValueError:
        keep = {"raw_length": len(body)}
    print(json.dumps({"status": status, "summary": keep})[:2000])
    return {"status": status}
