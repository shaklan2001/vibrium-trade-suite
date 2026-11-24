import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { searchProductHistory } from "@/lib/trade/productIndexStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/products/search?q=<product words or item code> → vendors with last prices, and the matching lines. */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "products-search", 60, 60_000);
  if (limited) return limited;
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ query: q, hits: [], vendors: [] }, { headers: NO_STORE });
  try {
    const found = await searchProductHistory(q);
    // The index lines carry word lists; the client only needs the line facts.
    return NextResponse.json(
      { query: found.query, vendors: found.vendors, hits: found.hits.map((h) => ({ score: h.score, ...h.line, words: undefined })) },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[products/search] failed", err);
    return jsonError(err, 502);
  }
}
