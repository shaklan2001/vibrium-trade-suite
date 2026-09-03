import { NextRequest, NextResponse } from "next/server";
import { streamCompletion } from "@/lib/vibrium/chat";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, "chat", 40, 60_000);
    if (limited) return limited;

    const body = (await req.json()) as {
      contactId?: string;
      message?: string;
      botId?: string;
    };

    const contactId = (body.contactId || "").trim();
    const message = (body.message || "").trim();
    if (!contactId || contactId.length > 128) {
      return NextResponse.json(
        { error: "Valid contactId is required" },
        { status: 400 },
      );
    }
    if (!message || message.length > 8000) {
      return NextResponse.json(
        { error: "Message is required (max 8000 chars)" },
        { status: 400 },
      );
    }

    const stream = await streamCompletion(
      contactId,
      message,
      req.signal,
      body.botId,
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
