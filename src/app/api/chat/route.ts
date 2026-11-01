import { NextRequest, NextResponse } from "next/server";
import { streamCompletion } from "@/lib/vibrium/chat";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildGroundedChatMessage } from "@/lib/trade/copilotGrounding";
import { getVibriumConfig } from "@/lib/vibrium/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const USER_MESSAGE_MAX = 2000;
const GROUNDED_MESSAGE_MAX = 16000;

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, "chat", 40, 60_000);
    if (limited) return limited;

    const body = (await req.json()) as {
      contactId?: string;
      message?: string;
      focusDealId?: string;
    };

    const contactId = (body.contactId || "").trim();
    const userMessage = (body.message || "").trim();
    if (!contactId || contactId.length > 128) {
      return NextResponse.json(
        { error: "Valid contactId is required" },
        { status: 400 },
      );
    }
    if (!userMessage || userMessage.length > USER_MESSAGE_MAX) {
      return NextResponse.json(
        { error: `Message is required (max ${USER_MESSAGE_MAX} chars)` },
        { status: 400 },
      );
    }

    // Always use platform service bot — never trust client-supplied bot ids.
    const { opsCopilotBotId } = getVibriumConfig();
    if (!opsCopilotBotId) {
      return NextResponse.json(
        { error: "Trade Copilot is not configured on the server" },
        { status: 503 },
      );
    }

    const grounded = (
      await buildGroundedChatMessage(userMessage, body.focusDealId)
    ).slice(0, GROUNDED_MESSAGE_MAX);

    const stream = await streamCompletion(
      contactId,
      grounded,
      req.signal,
      opsCopilotBotId,
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[chat]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to complete chat turn",
      },
      { status: 500 },
    );
  }
}
