import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isVibriumVoiceConfigured } from "@/lib/vibrium/config";
import { createWebCallSession } from "@/lib/vibrium/web-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OBJECT_JSON = 2000;

/** Accept only small plain objects for user/context echo. */
function smallObject(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  try {
    if (JSON.stringify(v).length > MAX_OBJECT_JSON) return undefined;
  } catch {
    return undefined;
  }
  return v as Record<string, unknown>;
}

/**
 * Mint a short-lived LiveKit room for Copilot voice (STT only).
 * Service credentials stay server-side; the browser only gets the room token.
 * Same gating as /api/chat (rate limit + server config).
 */
export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, "voice", 20, 60_000);
    if (limited) return limited;

    if (!isVibriumVoiceConfigured()) {
      return NextResponse.json(
        { error: "Vibrium is not configured" },
        { status: 503 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      contactId?: string;
      contactName?: string;
      mode?: string;
      user?: unknown;
      context?: unknown;
    };

    const contactId = (body.contactId || "").trim();
    if (!contactId || contactId.length > 128) {
      return NextResponse.json(
        { error: "Valid contactId is required" },
        { status: 400 },
      );
    }

    const user = {
      ...(smallObject(body.user) ?? {}),
      contact_id: contactId,
    };
    const context = smallObject(body.context);

    const session = await createWebCallSession({
      mode: body.mode === "voice" ? "voice" : "hybrid",
      user,
      context,
    });

    return NextResponse.json({ ok: true, ...session });
  } catch (err) {
    console.error("[voice]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to start voice session",
      },
      { status: 500 },
    );
  }
}
