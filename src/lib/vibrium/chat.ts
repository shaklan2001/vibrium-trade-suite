import { getVibriumConfig } from "./config";
import { vibriumFetch } from "./auth";

function chatBase(contactId: string, botId?: string) {
  const { agentsBaseUrl, customerId, opsCopilotBotId } = getVibriumConfig();
  const id = botId || opsCopilotBotId;
  if (!id) throw new Error("Ops copilot bot ID is not configured");
  return `${agentsBaseUrl}/chat/customerId/${customerId}/botId/${id}/contactId/${encodeURIComponent(contactId)}`;
}

export async function startSession(contactId: string, botId?: string) {
  const res = await vibriumFetch(`${chatBase(contactId, botId)}/chat/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to start chat (${res.status}): ${text}`);
  }
  return (await res.json()) as { session_id: string };
}

export async function streamCompletion(
  contactId: string,
  message: string,
  signal?: AbortSignal,
  botId?: string,
): Promise<ReadableStream<Uint8Array>> {
  const res = await vibriumFetch(`${chatBase(contactId, botId)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      stream: true,
      channel: "whatsapp",
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Chat completion failed (${res.status}): ${text}`);
  }
  return res.body;
}
