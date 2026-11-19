import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { loadThread } from "@/lib/mail/inboxService";
import { mailRef } from "@/lib/mail/mailLink";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import { threadKeyFor } from "@/lib/mail/thread";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { findDealByRef } from "@/lib/trade/dealLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/mail/open?deal=<short deal key>&mail=<ref | latest>
 *     /api/mail/open?key=<processed deal id>&mail=…   (the inbox resolves the short key from its own book: no book load here)
 * Resolves an email link (src/lib/mail/mailLink.ts) to its conversation, so the inbox can
 * open the thread with that message highlighted. Returns { item, mailRef }.
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "mail-open", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  const sp = new URL(req.url).searchParams;
  const dealRef = (sp.get("deal") || "").slice(0, 200);
  const dealKey = (sp.get("key") || "").slice(0, 500);
  const ref = (sp.get("mail") || "").toLowerCase();
  if (!(dealRef || dealKey) || !(/^[0-9a-f]{8}$/.test(ref) || ref === "latest"))
    return jsonError("deal and mail are required", 400);
  try {
    let key = dealKey;
    if (!key) {
      const deal = findDealByRef((await getCopilotBook()).deals, dealRef);
      if (!deal?.mailboxSourceId) return jsonError("That deal is not in the book", 404);
      key = deal.mailboxSourceId;
    }
    const messages = await getMailStore().messagesForDeal(key, 200);
    const hit =
      ref === "latest"
        ? messages[messages.length - 1]
        : messages.find((m) => mailRef(m.internet_message_id || m.provider_message_id) === ref);
    if (!hit) return jsonError("That email is not in the connected mailboxes", 404);
    const threadKey = hit.thread_key || threadKeyFor(hit.subject, hit.internet_message_id || hit.provider_message_id);
    const item = await loadThread(threadKey);
    if (!item) return jsonError("That conversation is no longer in the inbox", 404);
    return NextResponse.json({ item, mailRef: mailRef(hit.internet_message_id || hit.provider_message_id) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[mail/open] failed", err);
    return jsonError(err, 502);
  }
}
