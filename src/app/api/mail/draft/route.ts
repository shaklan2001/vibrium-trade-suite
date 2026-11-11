import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { loadInboxItem } from "@/lib/mail/inbox";
import { copilotRewrite } from "@/lib/mail/replyAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/mail/draft { id } — have the Vibrium Copilot agent write the reply
 * for one inbox thread. The client keeps the template draft if this fails.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "mail-draft", 30, 60_000);
  if (limited) return limited;
  try {
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (!id || id.length > 300) return jsonError("id required", 400);
    const item = await loadInboxItem(id);
    if (!item?.draft) return jsonError("Nothing to reply to in this thread", 404);
    const body = await copilotRewrite(item, item.signer);
    return NextResponse.json(
      { draft: { ...item.draft, body, by: "copilot" as const } },
      { headers: NO_STORE },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return jsonError(aborted ? "The Copilot agent took too long — keeping the quick draft" : err, aborted ? 504 : 502);
  }
}
