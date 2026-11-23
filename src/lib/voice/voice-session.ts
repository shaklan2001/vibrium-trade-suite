/**
 * Browser LiveKit lifecycle for Copilot voice (STT in, text out).
 *
 * Built to feel instant:
 *   - Room credentials are fetched ahead of time (prefetchVoiceCredentials)
 *     when the Copilot opens, so the click never waits on /api/voice.
 *   - On click the mic opens first (getUserMedia) and starts LiveKit's
 *     pre-connect buffer, so speech is recorded from the first moment.
 *   - The room then connects in the background in the order the Vibrium
 *     worker expects: connect → startAudio → session_init on "session" →
 *     publish mic. The buffered audio is handed to the agent once it is active.
 *
 * Agent audio is NOT played by default: replies stay on the normal text
 * /api/chat path and are spoken by browser talkback instead.
 */

import type { LocalAudioTrack, Room as LkRoom, RemoteTrack } from "livekit-client";

/**
 * connecting → mic_live (mic is recording) → connected (room joined)
 * → ready (mic published to the worker). reconnecting on network blips.
 */
export type VoiceStatus = "connecting" | "mic_live" | "connected" | "ready" | "reconnecting";
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
};

export type VoiceSessionInput = {
  contactId: string;
  contactName?: string;
  user?: Record<string, unknown>;
  context?: Record<string, unknown>;
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


// ------------------------------------------------------------ prefetching

type VoiceCredentials = {
  token: string;
  url: string;
  callSid?: string;
  user?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

/** LiveKit tokens from web-call live 6h; reuse a prefetched one for up to 5h. */
const CREDENTIALS_MAX_AGE_MS = 5 * 60 * 60 * 1000;
const credentialCache = new Map<string, { at: number; promise: Promise<VoiceCredentials> }>();
let livekitModule: Promise<typeof import("livekit-client")> | null = null;

async function fetchCredentials(input: VoiceSessionInput): Promise<VoiceCredentials> {
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
    throw new Error(
      "Couldn't reach the Trade Suite server to start voice. Check the app is running and reload.",
    );
  }
  const body = (await res.json().catch(() => ({}))) as Partial<VoiceCredentials> & {
    error?: string;
  };
  if (!res.ok || !body.token || !body.url) {
    const fallback =
      res.status === 429
        ? "Too many voice starts. Wait a minute and try again."
        : res.status === 503
          ? "Voice is not configured on the server."
          : `Voice start failed (${res.status})`;
    throw new Error(body.error && res.status !== 503 ? body.error : fallback);
  }
  return {
    token: body.token,
    url: body.url,
    callSid: body.callSid,
    user: body.user,
    context: body.context,
  };
}

/** Load the LiveKit SDK ahead of the first click (it is code-split). */
export function preloadVoiceModule(): Promise<typeof import("livekit-client")> {
  livekitModule ??= import("livekit-client");
  return livekitModule;
}

/**
 * Fetch room credentials in the background so the mic click doesn't wait on
 * /api/voice (≈1–6 s). Minting creates no room — the room and the agent only
 * start when the browser joins — so prefetching is free. Each start consumes
 * one prefetched token; call this again after a session to stay warm.
 */
export function prefetchVoiceCredentials(input: VoiceSessionInput): void {
  if (!isVoiceSessionSupported()) return;
  const hit = credentialCache.get(input.contactId);
  if (hit && Date.now() - hit.at < CREDENTIALS_MAX_AGE_MS) return;
  const promise = fetchCredentials(input);
  credentialCache.set(input.contactId, { at: Date.now(), promise });
  promise.catch(() => {
    if (credentialCache.get(input.contactId)?.promise === promise) {
      credentialCache.delete(input.contactId);
    }
  });
  void preloadVoiceModule().catch(() => undefined);
}

/** Use a prefetched token if there is a fresh one, otherwise fetch now. */
function takeCredentials(input: VoiceSessionInput): Promise<VoiceCredentials> {
  const hit = credentialCache.get(input.contactId);
  credentialCache.delete(input.contactId);
  if (hit && Date.now() - hit.at < CREDENTIALS_MAX_AGE_MS) {
    return hit.promise.catch(() => fetchCredentials(input));
  }
  return fetchCredentials(input);
}

// ------------------------------------------------------------ session

/**
 * Start voice. Resolves as soon as the microphone is recording (≈100–300 ms
 * once permission is granted); the LiveKit room connects in the background
 * and reports progress through handlers.onStatus. Failures after this point
 * arrive through handlers.onError followed by handlers.onEnded.
 */
export async function startVoiceSession(
  input: VoiceSessionInput & {
    playAgentAudio?: boolean;
    handlers: VoiceHandlers;
  },
): Promise<VoiceSessionHandle> {
  const { handlers } = input;
  const playAgentAudio = input.playAgentAudio ?? false;
  const t0 = performance.now();
  const mark = (what: string) =>
    console.debug(`[voice] ${what} +${Math.round(performance.now() - t0)}ms`);

  handlers.onStatus?.("connecting");
  const credentials = takeCredentials(input);
  credentials.catch(() => undefined); // surfaced below
  const lk = await preloadVoiceModule();
  const { Room, RoomEvent, Track } = lk;

  // 1. Mic first, recording into the pre-connect buffer.
  let track: LocalAudioTrack;
  try {
    track = await lk.createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  } catch (err) {
    throw new Error(friendlyError(err));
  }
  try {
    track.startPreConnectBuffer();
  } catch {
    /* older browsers without MediaRecorder — live audio still works */
  }
  mark("mic live");
  handlers.onStatus?.("mic_live");

  const room: LkRoom = new Room({ adaptiveStream: true, dynacast: true });
  const attached: HTMLMediaElement[] = [];
  let stopped = false;
  let ended = false;
  let published = false;
  let firstTranscript = true;

  const fireEnded = () => {
    if (ended) return;
    ended = true;
    handlers.onEnded?.();
  };

  const isLocal = (identity?: string) =>
    !identity || identity === room.localParticipant.identity;

  const emit = (role: VoiceRole, text: string, meta: { isFinal?: boolean; segmentId?: string }) => {
    if (stopped) return;
    if (firstTranscript && role === "user") {
      firstTranscript = false;
      mark("first transcript");
    }
    handlers.onTranscript?.(role, text, meta);
  };

  // 2. Register handlers before connect.
  room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
    const role: VoiceRole = isLocal(participant?.identity) ? "user" : "agent";
    for (const seg of segments) {
      if (!seg.text?.trim()) continue;
      emit(role, seg.text, { isFinal: seg.final, segmentId: seg.id });
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
    emit(parsed.role, parsed.text, { isFinal: parsed.isFinal, segmentId: parsed.segmentId });
  });

  if (typeof room.registerTextStreamHandler === "function") {
    try {
      room.registerTextStreamHandler(TEXT_STREAM_TOPIC, async (reader, info) => {
        const text = await reader.readAll().catch(() => "");
        if (!text.trim()) return;
        emit(isLocal(info?.identity) ? "user" : "agent", text, { isFinal: true });
      });
    } catch {
      /* already registered / unsupported */
    }
  }

  room.on(RoomEvent.TrackSubscribed, (remote: RemoteTrack) => {
    if (!playAgentAudio || remote.kind !== Track.Kind.Audio) return;
    const el = remote.attach();
    el.style.display = "none";
    document.body.appendChild(el);
    attached.push(el);
  });

  room.on(RoomEvent.Reconnecting, () => handlers.onStatus?.("reconnecting"));
  room.on(RoomEvent.Reconnected, () => handlers.onStatus?.("ready"));
  room.on(RoomEvent.Disconnected, () => {
    if (!stopped) fireEnded();
  });

  async function teardown() {
    if (stopped) return;
    stopped = true;
    try {
      track.stop();
    } catch {
      /* ignore */
    }
    if (published) {
      try {
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

  // 3. Connect in the background — the user is already being recorded.
  void (async () => {
    try {
      const creds = await credentials;
      mark("token ready");
      if (stopped) return;
      await room.connect(creds.url, creds.token);
      if (stopped) return;
      mark("room connected");
      handlers.onStatus?.("connected");
      await room.startAudio().catch(() => undefined);
      await room.localParticipant.publishData(
        new TextEncoder().encode(
          JSON.stringify({
            type: "session_init",
            user: creds.user ?? input.user ?? {},
            context: creds.context ?? input.context ?? {},
          }),
        ),
        { reliable: true, topic: SESSION_INIT_TOPIC },
      );
      if (stopped) return;
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
        preConnectBuffer: true,
      });
      published = true;
      mark("mic published");
      handlers.onStatus?.("ready");
    } catch (err) {
      if (stopped) return;
      const message = friendlyError(err);
      await teardown();
      handlers.onError?.(message);
    }
  })();

  return {
    stop: teardown,
    // Mute/unmute the local track: works before and after it is published.
    setMicEnabled: async (enabled: boolean) => {
      if (stopped) return;
      try {
        if (enabled) await track.unmute();
        else await track.mute();
      } catch (err) {
        const message = friendlyError(err);
        handlers.onError?.(message);
        throw new Error(message);
      }
    },
  };
}
