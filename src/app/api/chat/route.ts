import { NextRequest, NextResponse } from "next/server";
import { streamCompletion } from "@/lib/vibrium/chat";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildGroundedChatMessage } from "@/lib/trade/copilotGrounding";
import { getVibriumConfig } from "@/lib/vibrium/config";
import type { CommercialModelFilter } from "@/lib/trade/commercialModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const USER_MESSAGE_MAX = 2000;
const GROUNDED_MESSAGE_MAX = 16000;
const VOICE_TURN_HINT =
  "[Voice turn: the user spoke this question and the reply will be read aloud. " +
  "Keep it short enough to hear (2-4 sentences), in plain spoken English. " +
  "Lead with the answer; avoid tables, long lists, and reading out IDs or menus.]";

const BOOK_FILTERS = new Set<CommercialModelFilter>([
  "all",
  "agency_commission",
  "trader_principal",
]);

function cleanId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && t.length <= 160 ? t : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, "chat", 40, 60_000);
    if (limited) return limited;

    const body = (await req.json()) as {
      contactId?: string;
      message?: string;
      focusDealId?: string;
      /** Deals the previous answer was about — resolves "its", "that PO". */
      activeDealIds?: unknown;
      /** Header Book filter (all | agency_commission | trader_principal). */
      bookFilter?: string;
      voice?: boolean;
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

    const grounding = await buildGroundedChatMessage(userMessage, {
      focusDealId: cleanId(body.focusDealId),
      activeDealIds: Array.isArray(body.activeDealIds)
        ? body.activeDealIds.map(cleanId).filter((x): x is string => Boolean(x)).slice(0, 10)
        : undefined,
      bookFilter: BOOK_FILTERS.has(body.bookFilter as CommercialModelFilter)
        ? (body.bookFilter as CommercialModelFilter)
        : undefined,
    });
    let grounded = grounding.message.slice(0, GROUNDED_MESSAGE_MAX);
    if (body.voice === true) {
      grounded += `\n\n${VOICE_TURN_HINT}`;
    }

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
        // Deals this answer is about: "Open" chips + follow-up memory on the client.
        "X-Copilot-Deals": encodeURIComponent(JSON.stringify(grounding.deals)),
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
