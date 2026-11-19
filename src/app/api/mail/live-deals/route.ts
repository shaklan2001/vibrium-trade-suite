import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mail/live-deals → { ids }: deals with mail in a connected mailbox (their emails open in the inbox). */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "mail-live-deals", 30, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ ids: [] }, { headers: NO_STORE });
  try {
    return NextResponse.json({ ids: await getMailStore().liveDealKeys() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[mail/live-deals] failed", err);
    return jsonError(err, 502);
  }
}
