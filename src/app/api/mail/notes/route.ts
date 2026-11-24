import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { addDealNote, listDealNotes } from "@/lib/mail/dealRecords";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mail/notes?deal=<dealKey> → { notes }. Team notes from calls and chats (not in any email). */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "mail-notes", 120, 60_000);
  if (limited) return limited;
  const deal = new URL(req.url).searchParams.get("deal") || "";
  if (!deal) return jsonError("deal is required", 400);
  if (!mailStoreConfigured()) return NextResponse.json({ notes: [] }, { headers: NO_STORE });
  try {
    return NextResponse.json({ notes: await listDealNotes(getMailStore(), deal) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[mail/notes] list failed", err);
    return jsonError(err, 502);
  }
}

/** POST /api/mail/notes { deal, author, text } → { note } */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "mail-notes-add", 30, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const body = (await req.json()) as { deal?: string; author?: string; text?: string };
    if (!body.deal || !body.text?.trim()) return jsonError("deal and text are required", 400);
    const note = await addDealNote(getMailStore(), { dealKey: body.deal, author: body.author || "team", text: body.text });
    return NextResponse.json({ note }, { headers: NO_STORE });
  } catch (err) {
    console.error("[mail/notes] add failed", err);
    return jsonError(err, 502);
  }
}
