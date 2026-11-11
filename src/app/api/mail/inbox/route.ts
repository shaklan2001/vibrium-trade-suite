import { NextResponse } from "next/server";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { loadInbox } from "@/lib/mail/inbox";
import { mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/mail/inbox?source=book|live&limit=30
 * Agent inbox: newest mail per deal thread + what the worker read + a draft reply.
 * `book` uses the PST deal book (demo data), `live` the connected inboxes.
 */
export async function GET(req: Request) {
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source") === "live" ? "live" : "book";
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 30, 1), 60);
  try {
    const items = await loadInbox(source, limit);
    return NextResponse.json({ source, items }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
