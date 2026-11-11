import { NextResponse } from "next/server";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mail/messages?connection_id=&limit= — recently synced mail (headers only). */
export async function GET(req: Request) {
  // Setup checklist on the page explains a missing database; don't 500 here.
  if (!mailStoreConfigured()) return NextResponse.json({ messages: [] }, { headers: NO_STORE });
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
    const messages = await getMailStore().recentMessages({
      connectionId: searchParams.get("connection_id") || undefined,
      limit,
    });
    return NextResponse.json({ messages }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
