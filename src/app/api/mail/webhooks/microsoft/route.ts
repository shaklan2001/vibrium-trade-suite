import { after, NextRequest, NextResponse } from "next/server";
import { deadlineIn } from "@/lib/mail/api";
import { mailCronSecret } from "@/lib/mail/config";
import { safeEqual } from "@/lib/mail/crypto";
import { getMailStore } from "@/lib/mail/store";
import { runMailCycle } from "@/lib/mail/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s; work is chunked (MAIL_REQUEST_BUDGET_S).
export const maxDuration = 60;

/**
 * Microsoft Graph change notifications for `me/messages` (created).
 * Graph first POSTs ?validationToken=… which must be echoed as text/plain.
 */
export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const secret = mailCronSecret();
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!secret || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    value?: { subscriptionId?: string; clientState?: string }[];
  };
  const notes = body.value || [];
  const store = getMailStore();
  const conns = await store.listConnections();
  const ids = new Set<string>();
  for (const note of notes) {
    const conn = conns.find(
      (c) => c.provider === "microsoft" && c.cursor_json.ms_subscription_id === note.subscriptionId,
    );
    const expected = conn?.cursor_json.ms_client_state || "";
    if (conn && expected && note.clientState && safeEqual(note.clientState, expected)) {
      ids.add(conn.id);
    }
  }

  // Graph wants a 2xx within 3 seconds; sync happens after the response.
  after(async () => {
    for (const id of ids) {
      await runMailCycle({ connectionId: id, deadline: deadlineIn() }).catch(console.error);
    }
  });
  return new NextResponse(null, { status: 202 });
}
