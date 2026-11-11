import { NextResponse } from "next/server";
import { deadlineIn, jsonError, NO_STORE } from "@/lib/mail/api";
import { mailCronSecret } from "@/lib/mail/config";
import { safeEqual } from "@/lib/mail/crypto";
import { mailStoreConfigured } from "@/lib/mail/store";
import { runMailCycle } from "@/lib/mail/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s; work is chunked (MAIL_REQUEST_BUDGET_S).
export const maxDuration = 60;

/**
 * GET /api/mail/cron — scheduled sync of every connected inbox.
 * Vercel Cron (daily on Hobby) sends `Authorization: Bearer $CRON_SECRET`.
 * Free external schedulers (cron-job.org, UptimeRobot, GitHub Actions) can
 * send the same header or call /api/mail/cron?token=$CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = mailCronSecret();
  if (!secret) return jsonError("CRON_SECRET is not set", 503);
  const auth = req.headers.get("authorization") || "";
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!safeEqual(auth, `Bearer ${secret}`) && !safeEqual(token, secret)) {
    return jsonError("Unauthorized", 401);
  }
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const result = await runMailCycle({ deadline: deadlineIn() });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
