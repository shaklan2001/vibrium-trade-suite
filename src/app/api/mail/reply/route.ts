import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { MailboxError, replyFromMailbox, type ReplyMode } from "@/lib/mail/inboxService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 20_000;

/**
 * POST /api/mail/reply { connectionId, messageId, internetMessageId?, body, mode: "send" | "draft", draftId? }
 * Sends the reviewed reply over the mailbox's own SMTP login, threaded under
 * the original and filed in Sent — or saves it to that mailbox's Drafts.
 */
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
    };
    const mode: ReplyMode = input.mode === "draft" ? "draft" : "send";
    const body = (input.body || "").trim();
    if (!input.connectionId || input.connectionId.length > 300) return jsonError("connectionId required", 400);
    if (!input.messageId || input.messageId.length > 1000) return jsonError("messageId required", 400);
    if (!body) return jsonError("The reply is empty", 400);
    if (body.length > MAX_BODY) return jsonError("The reply is too long", 400);
    if (input.draftId && input.draftId.length > 1000) return jsonError("Invalid draftId", 400);
    const result = await replyFromMailbox({
      connectionId: input.connectionId,
      messageId: input.messageId,
      internetMessageId: input.internetMessageId?.slice(0, 1000) || null,
      body,
      mode,
      draftId: input.draftId || undefined,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof MailboxError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: NO_STORE });
    }
    console.error("[mail/reply] failed", err);
    return jsonError(err, 502);
  }
}
