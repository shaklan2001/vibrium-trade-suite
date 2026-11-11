"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { MarkdownMessage } from "@/components/copilot/markdown-message";
import { Loader2, MessageSquare, Mic, Square, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyVoiceSegment,
  createVoiceDraftState,
  type VoiceDraftState,
} from "@/lib/voice/voice-draft";
import {
  isVoiceSessionSupported,
  startVoiceSession,
  type VoiceSessionHandle,
} from "@/lib/voice/voice-session";
import {
  cancelTalkback,
  speakAssistantReply,
  toSpeakableText,
} from "@/lib/voice/voice-talkback";

function extractStreamPiece(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    const choices = json.choices as
      | Array<{ delta?: { content?: string }; text?: string }>
      | undefined;
    const choicePiece =
      choices?.[0]?.delta?.content || choices?.[0]?.text || "";
    const piece =
      (typeof json.reply === "string" && json.reply) ||
      (typeof json.message === "string" && json.message) ||
      (typeof json.delta === "string" && json.delta) ||
      (typeof json.content === "string" && json.content) ||
      (typeof json.text === "string" && json.text) ||
      choicePiece ||
      "";
    return piece;
  } catch {
    return payload;
  }
}

async function readStreamText(res: Response, onChunk: (t: string) => void) {
  if (!res.body) {
    const t = await res.text();
    onChunk(t);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed) continue;
      if (trimmed.startsWith("data:")) {
        const piece = extractStreamPiece(trimmed.slice(5).trim());
        if (piece) {
          full += piece;
          onChunk(full);
        }
      } else if (!trimmed.startsWith(":") && !trimmed.startsWith("event:")) {
        full += `${trimmed}\n`;
        onChunk(full);
      }
    }
  }
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data:")) {
      const piece = extractStreamPiece(trimmed.slice(5).trim());
      if (piece) {
        full += piece;
        onChunk(full);
      }
    } else {
      full += buffer;
      onChunk(full);
    }
  }
}

const VOICE_SILENCE_MS = 1600; // after any interim update
const VOICE_SILENCE_AFTER_FINAL_MS = 700; // after a final segment

type VoicePhase =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "listening"
  | "thinking"
  | "speaking";

const VOICE_STRIP: Record<Exclude<VoicePhase, "idle">, string> = {
  connecting: "Starting microphone… hang on a moment",
  reconnecting: "Reconnecting voice…",
  listening: "Listening… speak when ready",
  thinking: "Got it — Savvy is answering…",
  speaking: "Speaking the reply… tap ■ to stop",
};

export function CopilotPanel({
  compact = false,
  dealId,
}: {
  compact?: boolean;
  dealId?: string;
}) {
  const [contactId] = useState(() => `trade-${uuid()}`);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Voice refs — read inside LiveKit/timer callbacks, so never stale.
  const busyRef = useRef(false);
  const voiceModeRef = useRef(false);
  const voicePausedRef = useRef(false);
  const voiceSessionRef = useRef<VoiceSessionHandle | null>(null);
  const voiceDraftRef = useRef("");
  const voiceDraftStateRef = useRef<VoiceDraftState>(createVoiceDraftState());
  const voiceSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const voiceActive = voicePhase !== "idle";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setVoiceSupported(isVoiceSessionSupported());
  }, []);

  /**
   * Send one turn through the normal /api/chat path.
   * Returns the final assistant markdown, or null on failure.
   */
  async function sendText(
    raw: string,
    opts: { voice?: boolean } = {},
  ): Promise<string | null> {
    const text = raw.trim();
    if (!text || busyRef.current) return null;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);

    let reply = "";
    try {
      await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      }).catch(() => null);

      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          message: text,
          focusDealId: dealId || undefined,
          voice: opts.voice || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Chat failed (${res.status})`);
      }
      await readStreamText(res, (full) => {
        reply = full;
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: full };
          return copy;
        });
      });
      return reply;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function send() {
    if (voiceModeRef.current) {
      // In voice mode the Send button commits the spoken draft right away.
      void commitVoiceTranscript();
      return;
    }
    const text = input.trim();
    if (!text || busyRef.current) return;
    setInput("");
    await sendText(text);
  }

  // ---------------------------------------------------------------- voice

  function clearSilenceTimer() {
    if (voiceSilenceTimerRef.current) {
      clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }
  }

  function resetVoiceDraft() {
    voiceDraftStateRef.current = createVoiceDraftState();
    voiceDraftRef.current = "";
  }

  function tearDownVoiceSession() {
    voiceModeRef.current = false;
    voicePausedRef.current = false;
    clearSilenceTimer();
    cancelTalkback();
    const session = voiceSessionRef.current;
    voiceSessionRef.current = null;
    void session?.stop().catch(() => undefined);
    resetVoiceDraft();
    setVoicePhase("idle");
  }

  async function resumeVoiceListening() {
    if (!voiceModeRef.current) return;
    resetVoiceDraft();
    setInput("");
    voicePausedRef.current = false;
    setVoicePhase("listening");
    try {
      await voiceSessionRef.current?.setMicEnabled(true);
    } catch {
      /* onError already surfaced it */
    }
  }

  async function commitVoiceTranscript() {
    clearSilenceTimer();
    const text = voiceDraftRef.current.trim();
    if (!voiceModeRef.current || voicePausedRef.current || !text) return;
    if (busyRef.current) {
      // A turn is still streaming; try again shortly.
      voiceSilenceTimerRef.current = setTimeout(
        () => void commitVoiceTranscript(),
        VOICE_SILENCE_MS,
      );
      return;
    }

    voicePausedRef.current = true;
    setVoicePhase("thinking");
    resetVoiceDraft();
    setInput("");
    await voiceSessionRef.current?.setMicEnabled(false).catch(() => undefined);

    let talkbackText = "";
    try {
      const reply = await sendText(text, { voice: true });
      if (reply && voiceModeRef.current) talkbackText = toSpeakableText(reply);
    } finally {
      if (voiceModeRef.current && talkbackText) {
        setVoicePhase("speaking");
        try {
          await speakAssistantReply(talkbackText);
        } catch {
          toast.error("Couldn't read the reply aloud");
        }
      }
      await resumeVoiceListening();
    }
  }

  function applyVoiceTranscript(
    text: string,
    meta?: { isFinal?: boolean; segmentId?: string },
  ) {
    if (!voiceModeRef.current || voicePausedRef.current) return;
    const draft = applyVoiceSegment(voiceDraftStateRef.current, text, meta);
    voiceDraftRef.current = draft;
    setInput(draft);
    clearSilenceTimer();
    if (!draft) return;
    // Finals only shorten the wait — they never send on their own.
    voiceSilenceTimerRef.current = setTimeout(
      () => void commitVoiceTranscript(),
      meta?.isFinal ? VOICE_SILENCE_AFTER_FINAL_MS : VOICE_SILENCE_MS,
    );
  }

  async function startVoice() {
    if (busyRef.current) return;
    if (!isVoiceSessionSupported()) {
      setError("Voice needs a browser with microphone access (HTTPS).");
      return;
    }
    setError(null);
    resetVoiceDraft();
    setInput("");
    voiceModeRef.current = true;
    voicePausedRef.current = false;
    setVoicePhase("connecting");

    try {
      const session = await startVoiceSession({
        contactId,
        contactName: "Trade Suite user",
        playAgentAudio: false,
        user: {
          contact_id: contactId,
          name: "Trade Suite user",
          language: "en",
        },
        context: {
          device: "web",
          platform: "trade-suite",
          screen: "copilot",
          ...(dealId ? { focus_deal_id: dealId } : {}),
        },
        handlers: {
          onStatus: (s) => {
            if (!voiceModeRef.current) return;
            if (s === "reconnecting") setVoicePhase("reconnecting");
            else if (s === "connected" && !voicePausedRef.current) {
              setVoicePhase("listening");
            }
          },
          onTranscript: (role, text, meta) => {
            if (role === "user") applyVoiceTranscript(text, meta);
          },
          onError: (message) => setError(message),
          onEnded: () => {
            // Unexpected end (network / server hang-up) while still in voice mode.
            if (voiceModeRef.current && voiceSessionRef.current) {
              tearDownVoiceSession();
              setError("Voice session ended. Tap the mic to start again.");
            }
          },
        },
      });
      if (!voiceModeRef.current) {
        // User tapped stop while we were still connecting.
        await session.stop();
        return;
      }
      voiceSessionRef.current = session;
      if (!voicePausedRef.current) setVoicePhase("listening");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Voice failed to start";
      tearDownVoiceSession();
      setError(message);
      toast.error(message);
    }
  }

  function stopVoice() {
    const pendingDraft = voiceDraftRef.current.trim();
    const wasPaused = voicePausedRef.current;
    tearDownVoiceSession();
    setInput("");
    if (pendingDraft && !wasPaused) void sendText(pendingDraft);
  }

  function onVoice() {
    if (voiceModeRef.current) stopVoice();
    else void startVoice();
  }

  // Release mic + room if the panel unmounts (e.g. floating Copilot closed).
  useEffect(() => {
    return () => {
      voiceModeRef.current = false;
      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current);
      cancelTalkback();
      void voiceSessionRef.current?.stop().catch(() => undefined);
      voiceSessionRef.current = null;
    };
  }, []);

  const micDisabled = !voiceSupported || (busy && !voiceActive);

  return (
    <Card
      className={
        compact ? "flex h-[420px] flex-col" : "flex h-[70vh] flex-col"
      }
    >
      <CardHeader
        title="Trade Copilot · Savvy"
        description="Ask about the live book — deals, payments, teammates, ops"
      />
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-2 text-sm text-zinc-500">
            <p>
              Ask about the live book — overdue payments, a teammate&apos;s
              deals (e.g. kalpana), or what needs attention.
            </p>
            <p className="text-xs">
              Try: “How many open deals?”, “Show kalpana deals”, “What is
              overdue?”, “What’s next on this deal?”
            </p>
            {voiceSupported ? (
              <p className="text-xs">
                Or tap the mic and just ask — Savvy will answer out loud.
              </p>
            ) : null}
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-teal-50 px-3 py-2 text-sm text-zinc-800"
                : "mr-8 rounded-lg bg-zinc-100 px-3 py-2.5"
            }
          >
            {m.role === "assistant" ? (
              m.content ? (
                <MarkdownMessage content={m.content} />
              ) : busy && i === messages.length - 1 ? (
                <span className="text-sm text-zinc-500">…</span>
              ) : null
            ) : (
              m.content
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}
      {voiceActive ? (
        <div
          className="flex items-center gap-2 border-t border-teal-100 bg-teal-50 px-4 py-1.5 text-xs text-teal-800"
          role="status"
          aria-live="polite"
        >
          {voicePhase === "connecting" || voicePhase === "reconnecting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : voicePhase === "speaking" ? (
            <Volume2 className="h-3.5 w-3.5" />
          ) : (
            <span className="relative flex h-2 w-2">
              {voicePhase === "listening" ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-75" />
              ) : null}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-600" />
            </span>
          )}
          {VOICE_STRIP[voicePhase]}
        </div>
      ) : null}
      <div className="flex gap-2 border-t border-zinc-100 p-3">
        <Input
          value={input}
          onChange={(e) => {
            if (!voiceModeRef.current) setInput(e.target.value);
          }}
          readOnly={voiceActive}
          disabled={voiceActive && busy}
          placeholder={
            voiceActive
              ? voicePhase === "connecting"
                ? "Starting microphone…"
                : "Listening…"
              : "Ask Savvy about Trade Suite…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button
          type="button"
          onClick={onVoice}
          disabled={micDisabled}
          aria-label={voiceActive ? "Stop voice" : "Speak to Copilot"}
          aria-pressed={voiceActive}
          aria-busy={voicePhase === "connecting"}
          title={
            !voiceSupported
              ? "Voice needs microphone access (HTTPS)"
              : voiceActive
                ? "Stop voice"
                : "Speak to Copilot"
          }
          className={
            "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition disabled:opacity-50 " +
            (voiceActive
              ? "border-teal-700 bg-teal-700 text-white hover:bg-teal-800"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")
          }
        >
          {voicePhase === "listening" ? (
            <span className="absolute inset-0 animate-pulse rounded-md ring-2 ring-teal-400" />
          ) : null}
          {voicePhase === "connecting" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : voiceActive ? (
            <Square className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
        <Button
          onClick={() => void send()}
          disabled={busy || (voiceActive && !input.trim())}
        >
          Send
        </Button>
      </div>
    </Card>
  );
}

export function FloatingCopilot() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open ? (
        <div className="mb-2 w-[min(100vw-2rem,380px)] animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="mb-1 flex justify-end">
            <button
              className="rounded-full border border-zinc-200 bg-white p-1 shadow transition hover:bg-zinc-50"
              onClick={() => setOpen(false)}
              aria-label="Close copilot"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <CopilotPanel compact />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-teal-800"
        >
          <MessageSquare className="h-4 w-4" />
          Copilot
        </button>
      )}
    </div>
  );
}
