import { NextRequest, NextResponse } from "next/server";
import { getVibriumConfig } from "@/lib/vibrium/config";
import { vibriumFetch } from "@/lib/vibrium/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Server-side proxy for Vibrium customer APIs (avoids CORS issues). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, await ctx.params, undefined);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const body = await req.text();
  return proxy(req, await ctx.params, body);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const body = await req.text();
  return proxy(req, await ctx.params, body);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, await ctx.params, undefined);
}

async function proxy(
  req: NextRequest,
  params: { path: string[] },
  body: string | undefined,
) {
  try {
    const limited = checkRateLimit(req, "proxy", 120, 60_000);
    if (limited) return limited;

    const { apiBaseUrl, customerId } = getVibriumConfig();
    const sub = (params.path || []).join("/");
    const qs = req.nextUrl.search;
    const url = `${apiBaseUrl}/v1/customers/${customerId}/${sub}${qs}`;

    const res = await vibriumFetch(url, {
      method: req.method,
      headers: {
        "Content-Type": req.headers.get("content-type") || "application/json",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    console.error("[proxy]", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Proxy failed",
      },
      { status: 500 },
    );
  }
}
