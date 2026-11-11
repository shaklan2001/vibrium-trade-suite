/**
 * Browser LiveKit lifecycle for Copilot voice (STT in, text out).
 *
 * Flow (do not reorder — the Vibrium worker waits for session_init before STT):
 *   POST /api/voice → new Room → register handlers → connect → startAudio
 *   → publish session_init on topic "session" → enable mic.
 *
 * Agent audio is NOT played by default: replies stay on the normal text
 * /api/chat path and are spoken by browser talkback instead.
 */

import type { Room as LkRoom, RemoteTrack } from "livekit-client";

export type VoiceStatus = "connecting" | "connected" | "reconnecting";
export type VoiceRole = "user" | "agent";

export type VoiceHandlers = {
  onStatus?: (s: VoiceStatus) => void;
  onTranscript?: (
    role: VoiceRole,
    text: string,
    meta?: { isFinal?: boolean; segmentId?: string },
  ) => void;
  onError?: (message: string) => void;
  onEnded?: () => void;
};

export type VoiceSessionHandle = {
  stop: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => Promise<void>;
  callSid?: string;
};

export const SESSION_INIT_TOPIC = "session";
export const TRANSCRIPT_TOPIC = "vibrium.voice.transcript";
export const TEXT_STREAM_TOPIC = "lk.chat";
export const DEFAULT_VOICE_MODE = "hybrid";

const MIC_DENIED_MESSAGE =
  "Microphone access denied. Allow mic in your browser and try again.";

export function isVoiceSessionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function friendlyError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    /permission|notallowed|denied|microphone/i.test(`${name} ${msg}`)
  ) {
    return MIC_DENIED_MESSAGE;
  }
  if (name === "NotFoundError" || /requested device not found/i.test(msg)) {
    return "No microphone found. Connect a mic and try again.";
  }
  return msg || "Voice session failed";
}

type ParsedTranscript = {
  role: VoiceRole;
  text: string;
  isFinal: boolean;
  segmentId?: string;
};

/** Heuristic parse of Vibrium data-channel transcript payloads. */
export function parseTranscriptPayload(raw: unknown): ParsedTranscript | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const type = typeof p.type === "string" ? p.type.toLowerCase() : "";
  const status = typeof p.status === "string" ? p.status.toLowerCase() : "";

  const alt = Array.isArray(p.alternatives)
    ? (p.alternatives[0] as Record<string, unknown> | undefined)
    : undefined;
  const textCandidate = [
    p.text,
    p.transcript,
    p.content,
    p.partial,
    p.message,
    alt?.transcript,
  ].find((v) => typeof v === "string" && v.trim());
  if (typeof textCandidate !== "string") return null;

  const roleRaw = String(p.role ?? p.speaker ?? p.source ?? "").toLowerCase();
  const role: VoiceRole =
    type === "assistant_text" ||
    roleRaw === "agent" ||
    roleRaw === "assistant" ||
    roleRaw === "bot"
      ? "agent"
      : "user";

  const explicitFinal = p.is_final ?? p.isFinal ?? p.final;
  let isFinal: boolean;
  if (typeof explicitFinal === "boolean") isFinal = explicitFinal;
  else if (/partial|interim/.test(type) || /partial|interim/.test(status)) isFinal = false;
  else if (/final|complete|done/.test(type) || /final|complete|done/.test(status)) isFinal = true;
  else isFinal = type === "transcript" || type === "assistant_text";

  const idRaw = p.segment_id ?? p.segmentId ?? p.id;
  return {
    role,
    text: textCandidate.trim(),
    isFinal,
    segmentId: typeof idRaw === "string" && idRaw ? idRaw : undefined,
  };
}

export async function startVoiceSession(input: {
  contactId: string;
  contactName?: string;
  playAgentAudio?: boolean;
  user?: Record<string, unknown>;
  context?: Record<string, unknown>;
  handlers: VoiceHandlers;
}): Promise<VoiceSessionHandle> {
  const { handlers } = input;
  const playAgentAudio = input.playAgentAudio ?? false;

  handlers.onStatus?.("connecting");

  // 1. Mint room credentials server-side.
  let res: Response;
  try {
    res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: input.contactId,
        contactName: input.contactName,
        mode: DEFAULT_VOICE_MODE,
        user: input.user,
        context: input.context,
      }),
    });
  } catch {
    // Network-level failure: server down, restarted, or offline.
    throw new Error(
      "Couldn't reach the Trade Suite server to start voice. Check the app is running and reload.",
    );
  }
  const session = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    token?: string;
    url?: string;
    callSid?: string;
    user?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };
  if (!res.ok || !session.token || !session.url) {
    const fallback =
      res.status === 429
        ? "Too many voice starts. Wait a minute and try again."
        : res.status === 503
          ? "Voice is not configured on the server."
          : `Voice start failed (${res.status})`;
    throw new Error(session.error && res.status !== 503 ? session.error : fallback);
  }

  // 2. Lazy-load LiveKit so it never ships in SSR / non-voice bundles.
  const { Room, RoomEvent, Track } = await import("livekit-client");
  const room: LkRoom = new Room({ adaptiveStream: true, dynacast: true });
  const attached: HTMLMediaElement[] = [];
  let stopped = false;
  let ended = false;

  const fireEnded = () => {
    if (ended) return;
    ended = true;
    handlers.onEnded?.();
  };

  const isLocal = (identity?: string) =>
    !identity || identity === room.localParticipant.identity;

  // 3. Register handlers BEFORE connect.
  room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
    const role: VoiceRole = isLocal(participant?.identity) ? "user" : "agent";
    for (const seg of segments) {
      if (!seg.text?.trim()) continue;
      handlers.onTranscript?.(role, seg.text, {
        isFinal: seg.final,
        segmentId: seg.id,
      });
    }
  });

  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic && topic !== TRANSCRIPT_TOPIC) return;
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    const parsed = parseTranscriptPayload(json);
    if (!parsed) return;
    handlers.onTranscript?.(parsed.role, parsed.text, {
      isFinal: parsed.isFinal,
      segmentId: parsed.segmentId,
    });
  });

  if (typeof room.registerTextStreamHandler === "function") {
    try {
      room.registerTextStreamHandler(TEXT_STREAM_TOPIC, async (reader, info) => {
        const text = await reader.readAll().catch(() => "");
        if (!text.trim()) return;
        handlers.onTranscript?.(isLocal(info?.identity) ? "user" : "agent", text, {
          isFinal: true,
        });
      });
    } catch {
      /* already registered / unsupported */
    }
  }

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (!playAgentAudio || track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.style.display = "none";
    document.body.appendChild(el);
    attached.push(el);
  });

  room.on(RoomEvent.Reconnecting, () => handlers.onStatus?.("reconnecting"));
  room.on(RoomEvent.Reconnected, () => handlers.onStatus?.("connected"));
  room.on(RoomEvent.Disconnected, () => {
    if (!stopped) fireEnded();
  });

  async function teardown() {
    stopped = true;
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      /* ignore */
    }
    for (const pub of [...room.localParticipant.audioTrackPublications.values()]) {
      const track = pub.track;
      if (!track) continue;
      try {
        track.stop();
        await room.localParticipant.unpublishTrack(track, true);
      } catch {
        /* ignore */
      }
    }
    for (const el of attached.splice(0)) {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {
        /* ignore */
      }
    }
    try {
      room.unregisterTextStreamHandler?.(TEXT_STREAM_TOPIC);
    } catch {
      /* ignore */
    }
    room.removeAllListeners();
    try {
      await room.disconnect();
    } catch {
      /* ignore */
    }
    fireEnded();
  }

  try {
    // 4–5. Connect, unlock autoplay.
    await room.connect(session.url, session.token);
    handlers.onStatus?.("connected");
    await room.startAudio().catch(() => undefined);

    // 6. session_init — the worker gates STT on this.
    await room.localParticipant.publishData(
      new TextEncoder().encode(
        JSON.stringify({
          type: "session_init",
          user: session.user ?? input.user ?? {},
          context: session.context ?? input.context ?? {},
        }),
      ),
      { reliable: true, topic: SESSION_INIT_TOPIC },
    );

    // 7. Mic on.
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    await teardown();
    throw new Error(friendlyError(err));
  }

  return {
    callSid: session.callSid,
    stop: teardown,
    setMicEnabled: async (enabled: boolean) => {
      if (stopped) return;
      try {
        await room.localParticipant.setMicrophoneEnabled(enabled);
      } catch (err) {
        const message = friendlyError(err);
        handlers.onError?.(message);
        throw new Error(message);
      }
    },
  };
}
