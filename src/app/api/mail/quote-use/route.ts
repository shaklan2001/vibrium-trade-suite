import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/mail/quote-use { deal, messageId, items } — one row each time the quote panel is opened. */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "quote-use", 120, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ ok: false }, { headers: NO_STORE });
  try {
    const body = (await req.json()) as { deal?: string; messageId?: string; items?: number };
    if (!body.deal || !body.messageId) return jsonError("deal and messageId are required", 400);
    await getMailStore().upsertRecords([
      { kind: "quote_use", id: `${body.messageId}`, dealKey: body.deal, data: { items: body.items ?? 0, id2: randomUUID() } },
    ]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err, 502);
  }
}

/** GET /api/mail/quote-use → { opened }: quote requests whose panel was opened (the "used on ≥ 50%" measure). */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "quote-use-read", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ opened: 0 }, { headers: NO_STORE });
  try {
    const rows = await getMailStore().listRecords({ kind: "quote_use", limit: 5000 });
    return NextResponse.json({ opened: rows.length }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err, 502);
  }
}
