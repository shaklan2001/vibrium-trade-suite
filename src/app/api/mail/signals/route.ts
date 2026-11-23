import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getSignalIndex } from "@/lib/mail/signalStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mail/signals → open items read from each deal's emails (mail-driven early warnings). */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "mail-signals", 60, 60_000);
  if (limited) return limited;
  try {
    const index = await getSignalIndex();
    return NextResponse.json(index, { headers: NO_STORE });
  } catch (err) {
    console.error("[mail/signals] failed", err);
    return jsonError(err, 502);
  }
}
