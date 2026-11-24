import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { listNotifications, markNotificationRead } from "@/lib/mail/dealRecords";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications?owner=<email> → { notifications } (all owners when omitted). */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "notifications", 120, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ notifications: [] }, { headers: NO_STORE });
  try {
    const owner = new URL(req.url).searchParams.get("owner");
    return NextResponse.json({ notifications: await listNotifications(getMailStore(), owner?.toLowerCase() || null) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[notifications] list failed", err);
    return jsonError(err, 502);
  }
}

/** POST /api/notifications { id, owner } → marks one notification read. */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "notifications-read", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const body = (await req.json()) as { id?: string; owner?: string };
    if (!body.id || !body.owner) return jsonError("id and owner are required", 400);
    const ok = await markNotificationRead(getMailStore(), body.id, body.owner.toLowerCase());
    return NextResponse.json({ ok }, { headers: NO_STORE });
  } catch (err) {
    console.error("[notifications] read failed", err);
    return jsonError(err, 502);
  }
}
