import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { loadThread } from "@/lib/mail/inboxService";
import { copilotRewrite } from "@/lib/mail/replyAgent";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import type { InboxItem, ReplyDraft } from "@/lib/mail/inboxTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/mail/draft { threadKey }
 * Loads the whole conversation (every mailbox that has a copy) and has Vibrium
 * Copilot write the reply. Returns the refreshed item + draft; if Copilot is
 * unavailable the quick template draft comes back with a warning.
 * Every draft returned is logged (mail_reply_drafts) for live reply accuracy.
 */

/** Log the draft the person will see; never blocks or fails the draft itself. */
async function logged(item: InboxItem, threadKey: string, draft: ReplyDraft): Promise<ReplyDraft> {
  if (!mailStoreConfigured()) return draft;
  const id = randomUUID();
  try {
    await getMailStore().logDraft({
      id,
      thread_key: threadKey,
      deal_key: item.id,
      connection_id: item.mailbox.connectionId,
      message_id: item.mailbox.messageId,
      signer: item.signer,
      drafted_by: draft.by,
      prompt_version: draft.by === "copilot" ? "v2" : null,
      draft_body: draft.body,
    });
    return { ...draft, logId: id };
  } catch (err) {
    console.warn("[mail/draft] could not log draft", err);
    return draft;
  }
}
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "mail-draft", 30, 60_000);
  if (limited) return limited;
  try {
    const { threadKey } = (await req.json().catch(() => ({}))) as { threadKey?: string };
    if (!threadKey || threadKey.length > 1000) return jsonError("threadKey required", 400);
    const item = await loadThread(threadKey);
    if (!item) return jsonError("This conversation is no longer in the inbox", 404);
    if (!item.draft) return NextResponse.json({ item, draft: null }, { headers: NO_STORE });
    try {
      const body = await copilotRewrite(item, item.signer);
      const draft = await logged(item, threadKey, { ...item.draft, body, by: "copilot" });
      return NextResponse.json({ item, draft }, { headers: NO_STORE });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return NextResponse.json(
        {
          item,
          draft: await logged(item, threadKey, item.draft),
          warning: aborted ? "Copilot took too long — showing the quick draft" : "Copilot is unavailable — showing the quick draft",
        },
        { headers: NO_STORE },
      );
    }
  } catch (err) {
    console.error("[mail/draft] failed", err);
    return jsonError(err, 502);
  }
}
