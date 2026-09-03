import { NextRequest, NextResponse } from "next/server";
import { startSession } from "@/lib/vibrium/chat";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, "chat-start", 30, 60_000);
    if (limited) return limited;

    const body = (await req.json()) as { contactId?: string; botId?: string };
    const contactId = (body.contactId || "").trim();
    if (!contactId) {
      return NextResponse.json(
        { error: "contactId is required" },
        { status: 400 },
      );
    }

    const session = await startSession(contactId, body.botId);
    return NextResponse.json({ success: true, data: session });
  } catch (err) {
    console.error("[chat/start]", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to start session",
      },
      { status: 500 },
    );
  }
}
