import { NextResponse } from "next/server";
import { mintServiceToken, clearTokenCache } from "@/lib/vibrium/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(req, "token", 60, 60_000);
    if (limited) return limited;

    clearTokenCache();
    const token = await mintServiceToken();
    return NextResponse.json({
      success: true,
      data: {
        token,
        expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
      },
    });
  } catch (err) {
    console.error("[vibrium/token]", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Token mint failed",
      },
      { status: 500 },
    );
  }
}
