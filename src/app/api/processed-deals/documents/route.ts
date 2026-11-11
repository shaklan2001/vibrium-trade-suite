import { NextResponse } from "next/server";
import { deadlineIn, jsonError, NO_STORE } from "@/lib/mail/api";
import { mailCronSecret } from "@/lib/mail/config";
import { safeEqual } from "@/lib/mail/crypto";
import { isRdsProxyEnabled } from "@/lib/rdsProxy";
import {
  finalizeDealDocuments,
  planDealDocuments,
  startDealDocuments,
} from "@/lib/trade/documentExtraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IDS = 25;
const MAX_STARTS = 25;

/**
 * Read every PI / PO / invoice on some deals (each read is a paid agent run).
 *
 * POST { ids: ["po:G2625017", …], dryRun?: true }   plan only (default): what would be read, what is missing
 * POST { ids: […], dryRun: false, limit?: 10 }      start the reads
 * POST { finalize: true }                           collect finished reads
 * Authorization: Bearer $CRON_SECRET
 */
export async function POST(req: Request) {
  const secret = mailCronSecret();
  if (!secret) return jsonError("CRON_SECRET is not set", 503);
  if (!safeEqual(req.headers.get("authorization") || "", `Bearer ${secret}`)) {
    return jsonError("Unauthorized", 401);
  }
  if (!isRdsProxyEnabled()) return jsonError("Needs TRADE_SUITE_DB_MODE=rds-proxy", 501);

  let body: { ids?: unknown; dryRun?: unknown; limit?: unknown; finalize?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const deadline = deadlineIn();
  try {
    if (body.finalize === true) {
      return NextResponse.json(await finalizeDealDocuments({ deadline }), { headers: NO_STORE });
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_IDS)
      : [];
    if (!ids.length) return jsonError(`ids required (up to ${MAX_IDS})`, 400);
    const plan = await planDealDocuments(ids);
    if (body.dryRun !== false) {
      return NextResponse.json({ dryRun: true, ...plan }, { headers: NO_STORE });
    }
    const limit = Math.min(Math.max(Number(body.limit) || MAX_STARTS, 1), MAX_STARTS);
    const started = await startDealDocuments(plan.toRead, { deadline, limit });
    return NextResponse.json({ dryRun: false, ...plan, ...started }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
