import { vibriumFetch } from "./auth";
import { getVibriumConfig, getVoiceBotId } from "./config";

export type VoiceMode = "hybrid" | "voice";

export type WebCallSession = {
  token: string;
  url: string;
  roomName: string;
  participantIdentity?: string;
  callSid?: string;
  expiresAt?: number | string;
  mode: VoiceMode;
  user?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

function pickString(
  src: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = src[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * POST /v1/customers/{customerId}/web-call → LiveKit room credentials.
 * Response may be top-level or nested under `data`, camelCase or snake_case.
 */
export async function createWebCallSession(input: {
  mode?: VoiceMode;
  user?: Record<string, unknown>;
  context?: Record<string, unknown>;
}): Promise<WebCallSession> {
  const { apiBaseUrl, customerId } = getVibriumConfig();
  const botId = getVoiceBotId();
  if (!botId) throw new Error("Voice bot ID is not configured");
  const mode: VoiceMode = input.mode === "voice" ? "voice" : "hybrid";

  const res = await vibriumFetch(
    `${apiBaseUrl}/v1/customers/${customerId}/web-call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        bot_id: botId,
        mode,
        user: input.user ?? {},
        context: input.context ?? {},
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vibrium web-call failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data =
    json.data && typeof json.data === "object"
      ? (json.data as Record<string, unknown>)
      : json;

  const token = pickString(data, "token", "access_token", "accessToken");
  const url = pickString(data, "url", "livekit_url", "livekitUrl", "ws_url");
  const roomName = pickString(data, "roomName", "room_name", "room");
  if (!token || !url || !roomName) {
    throw new Error("Vibrium web-call response missing token, url, or room name");
  }

  const expiresRaw = data.expiresAt ?? data.expires_at;
  return {
    token,
    url,
    roomName,
    participantIdentity: pickString(data, "participantIdentity", "participant_identity"),
    callSid: pickString(data, "callSid", "call_sid"),
    expiresAt:
      typeof expiresRaw === "number" || typeof expiresRaw === "string"
        ? expiresRaw
        : undefined,
    mode,
    user: input.user,
    context: input.context,
  };
}
