import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { scoreEdit } from "@/lib/mail/draftLog";
import { MailboxError, replyFromMailbox, type ReplyMode } from "@/lib/mail/inboxService";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 20_000;

/**
 * POST /api/mail/reply { connectionId, messageId, internetMessageId?, body, mode: "send" | "draft", draftId?, draftLogId? }
 * Sends the reviewed reply over the mailbox's own SMTP login, threaded under
 * the original and filed in Sent — or saves it to that mailbox's Drafts.
 * On send, the sent text is stored next to the AI draft it started from (draftLogId).
 */

/** Live reply accuracy: store what was sent and how much the draft was changed. Never fails the send. */
async function recordSent(draftLogId: string, connectionId: string, body: string) {
  if (!mailStoreConfigured()) return;
  try {
    const store = getMailStore();
    const draft = await store.getDraft(draftLogId);
    if (!draft || draft.sent_at || draft.connection_id !== connectionId) return;
    const { similarity, editLevel } = scoreEdit(draft.draft_body, body);
    await store.recordDraftSent(draftLogId, { body, similarity, editLevel });
  } catch (err) {
    console.warn("[mail/reply] could not record sent reply", err);
  }
}
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "mail-reply", 20, 60_000);
  if (limited) return limited;
  try {
    const input = (await req.json().catch(() => ({}))) as {
      connectionId?: string;
      messageId?: string;
      internetMessageId?: string | null;
      body?: string;
      mode?: string;
      draftId?: string;
      draftLogId?: string;
    };
    const mode: ReplyMode = input.mode === "draft" ? "draft" : "send";
    const body = (input.body || "").trim();
    if (!input.connectionId || input.connectionId.length > 300) return jsonError("connectionId required", 400);
    if (!input.messageId || input.messageId.length > 1000) return jsonError("messageId required", 400);
    if (!body) return jsonError("The reply is empty", 400);
    if (body.length > MAX_BODY) return jsonError("The reply is too long", 400);
    if (input.draftId && input.draftId.length > 1000) return jsonError("Invalid draftId", 400);
    const draftLogId = typeof input.draftLogId === "string" && /^[0-9a-f-]{36}$/i.test(input.draftLogId) ? input.draftLogId : null;
    const result = await replyFromMailbox({
      connectionId: input.connectionId,
      messageId: input.messageId,
      internetMessageId: input.internetMessageId?.slice(0, 1000) || null,
      body,
      mode,
      draftId: input.draftId || undefined,
    });
    if (mode === "send" && draftLogId) await recordSent(draftLogId, input.connectionId, body);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof MailboxError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: NO_STORE });
    }
    console.error("[mail/reply] failed", err);
    return jsonError(err, 502);
  }
}
