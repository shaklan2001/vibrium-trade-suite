import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import {
  applyDealUpdate,
  DealUpdateError,
  listDealUpdates,
  searchDealsForUpdate,
  undoDealUpdate,
  validateUpdateInput,
} from "@/lib/trade/copilot/dealUpdates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof DealUpdateError) return jsonError(err.message, err.status);
  console.error("[copilot/updates]", err);
  return jsonError("Could not save the update. Try again.", 502);
}

/** GET /api/copilot/updates?deal=<dealKey>&limit=20 → { updates } (newest first). */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "copilot-updates", 120, 60_000);
  if (limited) return limited;
  const url = new URL(req.url);
  const dealKey = url.searchParams.get("deal")?.slice(0, 400) || undefined;
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 20, 100));
  try {
    return NextResponse.json({ updates: await listDealUpdates({ dealKey, limit }) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[copilot/updates] list failed", err);
    return NextResponse.json({ updates: [] }, { headers: NO_STORE });
  }
}

/**
 * POST /api/copilot/updates
 *   { action: "apply", confirmed: true, ...update }  → { update }   saves a confirmed off-mail update
 *   { action: "undo", id, by }                       → { update }   takes it back
 *   { action: "search", q }                          → { deals }    deals for the card's "change deal" box
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "copilot-updates-write", 30, 60_000);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  try {
    if (body.action === "search") {
      const q = typeof body.q === "string" ? body.q.trim().slice(0, 120) : "";
      return NextResponse.json({ deals: q.length >= 2 ? await searchDealsForUpdate(q) : [] }, { headers: NO_STORE });
    }
    if (body.action === "undo") {
      const update = await undoDealUpdate(String(body.id || ""), typeof body.by === "string" ? body.by : "team");
      return NextResponse.json({ update }, { headers: NO_STORE });
    }
    if (body.action === "apply") {
      // Saving needs an explicit yes from the confirm card — a proposal alone never writes.
      if (body.confirmed !== true) return jsonError("Confirm the update first.", 400);
      const update = await applyDealUpdate(validateUpdateInput(body));
      return NextResponse.json({ update }, { headers: NO_STORE });
    }
    return jsonError("Unknown action", 400);
  } catch (err) {
    return fail(err);
  }
}
