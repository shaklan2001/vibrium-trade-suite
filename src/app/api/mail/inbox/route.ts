import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, mailSetupStatus, NO_STORE } from "@/lib/mail/api";
import { loadInboxPage, MailboxError } from "@/lib/mail/inboxService";
import { mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mail/inbox?mailbox=all|<connectionId>&before_at=&before_key=&q=&limit=40
 * One keyset page of conversations from the synced store, plus every
 * connected team mailbox for the switcher.
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "mail-inbox", 90, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  const sp = new URL(req.url).searchParams;
  const beforeAt = sp.get("before_at");
  try {
    const page = await loadInboxPage({
      mailbox: sp.get("mailbox") || "all",
      before: beforeAt && !Number.isNaN(Date.parse(beforeAt)) ? { at: beforeAt, key: sp.get("before_key") || "" } : null,
      q: sp.get("q") || undefined,
      limit: Number(sp.get("limit")) || undefined,
    });
    return NextResponse.json({ ...page, setup: mailSetupStatus() }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof MailboxError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: NO_STORE });
    }
    console.error("[mail/inbox] failed", err);
    return jsonError(err, 502);
  }
}
