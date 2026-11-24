import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { takenStats, type NextActionState } from "@/lib/mail/nextAction";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mail/next-actions → { actions: { [dealKey]: NextAction & { readAt } }, stats }
 * The one next step per deal (Trade Next Action agent) and how often the team took it within two days.
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "mail-next-actions", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ actions: {}, stats: takenStats([]) }, { headers: NO_STORE });
  try {
    const store = getMailStore();
    const [records, logs] = await Promise.all([
      store.listRecords({ kind: "next_action", limit: 5000 }),
      store.listRecords({ kind: "next_action_log", limit: 5000 }),
    ]);
    const actions: Record<string, unknown> = {};
    for (const r of records) {
      const state = r.data as unknown as NextActionState;
      if (state.status === "done" && state.result) actions[r.id] = { ...state.result, readAt: state.readAt || r.updatedAt };
    }
    return NextResponse.json({ actions, stats: takenStats(logs) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[mail/next-actions] failed", err);
    return jsonError(err, 502);
  }
}
