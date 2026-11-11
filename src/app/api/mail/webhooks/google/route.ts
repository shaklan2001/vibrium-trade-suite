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
 * Gmail push via a Pub/Sub push subscription pointed at
 *   https://<site>/api/mail/webhooks/google?token=$CRON_SECRET
 * Payload data = base64({ emailAddress, historyId }).
 */
export async function POST(req: NextRequest) {
  const secret = mailCronSecret();
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!secret || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { message?: { data?: string } };
  let email = "";
  try {
    const decoded = JSON.parse(Buffer.from(body.message?.data || "", "base64").toString("utf8")) as {
      emailAddress?: string;
    };
    email = (decoded.emailAddress || "").toLowerCase();
  } catch {
    // ack malformed messages so Pub/Sub stops retrying
  }

  if (email) {
    const conns = await getMailStore().listConnections();
    const conn = conns.find((c) => c.provider === "google" && c.email === email);
    if (conn) {
      after(() =>
        runMailCycle({ connectionId: conn.id, deadline: deadlineIn() }).catch(console.error),
      );
    }
  }
  // Any 2xx acks the Pub/Sub message.
  return new NextResponse(null, { status: 204 });
}
