import { NextResponse } from "next/server";
import { mintServiceToken } from "@/lib/vibrium/auth";
import { getVibriumConfig } from "@/lib/vibrium/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { apiBaseUrl, customerId } = getVibriumConfig();
    const token = await mintServiceToken();
    return NextResponse.json({
      ok: true,
      apiBaseUrl,
      customerId,
      tokenPreview: `${token.slice(0, 8)}…`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Health check failed",
      },
      { status: 500 },
    );
  }
}
