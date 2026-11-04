import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { deadlineIn, jsonError, NO_STORE } from "@/lib/mail/api";
import { mailStoreConfigured } from "@/lib/mail/store";
import { runMailCycle } from "@/lib/mail/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s; work is chunked (MAIL_REQUEST_BUDGET_S).
export const maxDuration = 60;

/** Background auto-sync skips inboxes synced more recently than this. */
const AUTO_MIN_INTERVAL_MS = 2 * 60 * 1000;

/**
 * POST /api/mail/sync — one chunk of sync work.
 * { connection_id?: string, jobs_only?: boolean, auto?: boolean }
 *  - Sync now: called in a loop by the UI until `remaining` is 0.
 *  - auto: fired by open browser tabs every few minutes (free-tier stand-in for cron).
 *  - jobs_only: just checks running worker executions.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "mail-sync", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const body = (await req.json().catch(() => ({}))) as {
      connection_id?: string;
      jobs_only?: boolean;
      auto?: boolean;
    };
    const result = await runMailCycle({
      connectionId: body.connection_id || undefined,
      syncMail: !body.jobs_only,
      minIntervalMs: body.auto ? AUTO_MIN_INTERVAL_MS : undefined,
      push: body.auto,
      deadline: deadlineIn(body.jobs_only ? 25 : undefined),
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
