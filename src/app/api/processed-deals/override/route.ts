import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { invokeTradeSuiteRds, isRdsProxyEnabled } from "@/lib/rdsProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = new Set(["agency_commission", "trader_principal"]);

/**
 * Pin a mailbox deal's book (Agency ↔ Trader) by hand.
 * POST { id: "po:4329707", commercialModel: "trader_principal" | "agency_commission" | null }
 * null removes the pin so the automatic rules decide again.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "deal-override", 30, 60_000);
  if (limited) return limited;

  let body: { id?: unknown; commercialModel?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 400) : "";
  const model = body.commercialModel ?? null;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (model !== null && (typeof model !== "string" || !MODELS.has(model))) {
    return NextResponse.json(
      { error: "commercialModel must be agency_commission, trader_principal or null" },
      { status: 400 },
    );
  }
  if (!isRdsProxyEnabled()) {
    return NextResponse.json(
      { error: "Book overrides need TRADE_SUITE_DB_MODE=rds-proxy" },
      { status: 501 },
    );
  }

  try {
    const res = await invokeTradeSuiteRds<{ id: string; commercial_model_override: string | null }>({
      action: "set_deal_override",
      id,
      commercial_model: model,
    });
    if (!res.success) {
      const status = res.error === "Not found" ? 404 : 500;
      return NextResponse.json({ error: res.error || "Override failed" }, { status });
    }
    return NextResponse.json({ ok: true, ...res.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Override failed" },
      { status: 500 },
    );
  }
}
