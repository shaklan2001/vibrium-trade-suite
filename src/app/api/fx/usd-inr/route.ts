import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historical USD→INR for a calendar date (YYYY-MM-DD).
 * Uses Frankfurter (ECB) — display fallback when email FX is missing.
 */
export async function GET(request: NextRequest) {
  const dateParam = (request.nextUrl.searchParams.get("date") || "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today
      ? dateParam
      : today;

  try {
    // Frankfurter: /YYYY-MM-DD?from=USD&to=INR
    const url = `https://api.frankfurter.app/${date}?from=USD&to=INR`;
    const res = await fetch(url, { next: { revalidate: 86_400 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `FX provider HTTP ${res.status}`, date },
        { status: 502 },
      );
    }
    const body = (await res.json()) as {
      amount?: number;
      base?: string;
      date?: string;
      rates?: { INR?: number };
    };
    const rate = body.rates?.INR;
    if (!rate || !Number.isFinite(rate)) {
      return NextResponse.json(
        { error: "INR rate missing from provider", date },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        rate,
        date: body.date || date,
        source: "internet",
        provider: "frankfurter",
        warning: "Internet rate · not from email",
      },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "FX lookup failed",
        date,
      },
      { status: 500 },
    );
  }
}
