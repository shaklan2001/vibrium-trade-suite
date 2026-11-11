import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { loadThread } from "@/lib/mail/inboxService";
import { copilotRewrite } from "@/lib/mail/replyAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/mail/draft { threadKey }
 * Loads the whole conversation (every mailbox that has a copy) and has Vibrium
 * Copilot write the reply. Returns the refreshed item + draft; if Copilot is
 * unavailable the quick template draft comes back with a warning.
 */
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
      return NextResponse.json({ item, draft: { ...item.draft, body, by: "copilot" as const } }, { headers: NO_STORE });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return NextResponse.json(
        {
          item,
          draft: item.draft,
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
