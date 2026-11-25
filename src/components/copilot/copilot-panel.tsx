"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { MarkdownMessage } from "@/components/copilot/markdown-message";
import { DealUpdateCard, type DealUpdateCardState } from "@/components/copilot/deal-update-card";
import type { DealUpdateProposal } from "@/lib/trade/dealUpdate";
import { onOpenCopilot } from "@/lib/trade/dealUpdateEvents";
import { ArrowUpRight, MessageSquare, Mic, NotebookPen, Square, Volume2, X } from "lucide-react";
import { useTradeStore } from "@/lib/trade/store";
import type { CopilotDealRef } from "@/lib/trade/copilotGrounding";
import { toast } from "sonner";
import {
  applyVoiceSegment,
  createVoiceDraftState,
  type VoiceDraftState,
} from "@/lib/voice/voice-draft";
import {
  isVoiceSessionSupported,
  prefetchVoiceCredentials,
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

type VoicePhase = "idle" | "reconnecting" | "listening" | "thinking" | "speaking";

const VOICE_STRIP: Record<Exclude<VoicePhase, "idle">, string> = {
  reconnecting: "Reconnecting voice… keep talking",
  listening: "Listening — press Enter or Send when you're done",
  thinking: "Savvy is answering…",
  speaking: "Speaking the reply… tap ■ to stop",
};

/** Join typed/edited text with the live transcript. */
function joinDraft(base: string, spoken: string): string {
  const b = base.replace(/\s+$/, "");
  const t = spoken.trim();
  if (!b) return t;
  if (!t) return base;
  return `${b} ${t}`;
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Deals this answer is about (from the server) — shown as Open chips. */
  deals?: CopilotDealRef[];
  /** An off-mail update Copilot understood — shown as a confirm card, saved only on confirm. */
  proposal?: DealUpdateProposal;
  card?: DealUpdateCardState;
};

const UPDATE_EXAMPLES = [
  "Received $5K from the buyer on WhatsApp for PO 15269",
  "We paid the factory ₹2.5 lakh today for PO 14682",
  "Buyer said on call: ship 50% by air, balance by sea",
];

function proposalIntro(p: DealUpdateProposal): string {
  if (!p.deal) return "I can log this, but I need to know which deal it's for. Pick it below, check the details and confirm.";
  return p.type === "payment"
    ? `Got it — here's the payment I'll add to **${p.deal.code}**. Check it and confirm; nothing is saved until you do.`
    : `Got it — here's the note I'll add to **${p.deal.code}**. Check it and confirm; nothing is saved until you do.`;
}

function readDealRefs(res: Response): CopilotDealRef[] {
  const raw = res.headers.get("X-Copilot-Deals");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (d): d is CopilotDealRef =>
            Boolean(d) && typeof d.id === "string" && typeof d.href === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function CopilotPanel({
  compact = false,
  dealId,
  prefill,
}: {
  compact?: boolean;
  dealId?: string;
  /** Text to put in the composer when the panel opens (e.g. from "Log an update"). */
  prefill?: { text: string; at: number };
}) {
  const [contactId] = useState(() => `trade-${uuid()}`);
  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const bookFilter = useTradeStore((s) => s.commercialModelFilter);
  /** Deals the last answer was about — lets "its payment term?" resolve. */
  const activeDealIdsRef = useRef<string[]>([]);
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
  /** Live transcript of the current utterance (merged STT segments). */
  const voiceDraftRef = useRef("");
  const voiceDraftStateRef = useRef<VoiceDraftState>(createVoiceDraftState());
  /** Text the user typed or edited while talking — transcript appends after it. */
  const voiceBaseRef = useRef("");
  /** Segments already folded into an edit, so late revisions don't re-add them. */
  const voiceFoldedSegmentsRef = useRef<Set<string>>(new Set());
  const inputRef = useRef(input);
  inputRef.current = input;

  const voiceActive = voicePhase !== "idle";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setVoiceSupported(isVoiceSessionSupported());
  }, []);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [prefill]);

  function setCard(index: number, card: DealUpdateCardState) {
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, card } : msg)));
  }

  /** Who/where for the voice room — same values for prefetch and start. */
  function voiceInput() {
    return {
      contactId,
      contactName: "Trade Suite user",
      user: { contact_id: contactId, name: "Trade Suite user", language: "en" },
      context: {
        device: "web",
        platform: "trade-suite",
        screen: "copilot",
        ...(dealId ? { focus_deal_id: dealId } : {}),
      },
    };
  }

  // Warm voice when the Copilot opens: token + LiveKit SDK, so the mic click
  // starts recording immediately instead of waiting on the server.
  useEffect(() => {
    if (!voiceSupported) return;
    prefetchVoiceCredentials(voiceInput());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSupported, contactId]);

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
          activeDealIds: activeDealIdsRef.current,
          bookFilter,
          voice: opts.voice || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Chat failed (${res.status})`);
      }
      // An update ("received $5K on WhatsApp") comes back as a proposal to confirm, not an answer.
      if ((res.headers.get("Content-Type") || "").includes("application/json")) {
        const j = (await res.json().catch(() => ({}))) as { type?: string; proposal?: DealUpdateProposal };
        if (j.type !== "deal_update_proposal" || !j.proposal) throw new Error("Copilot sent an unexpected reply");
        const proposal = j.proposal;
        if (proposal.deal) activeDealIdsRef.current = [proposal.deal.id];
        const intro = proposalIntro(proposal);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: intro, proposal, card: { status: "draft" } };
          return copy;
        });
        return "I've got that update ready. Check it on screen and press confirm to save it.";
      }
      const deals = readDealRefs(res);
      if (deals.length) activeDealIdsRef.current = deals.map((d) => d.id);
      await readStreamText(res, (full) => {
        reply = full;
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: full, deals };
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
      // Speak as long as you like; Enter / Send is the only thing that sends.
      void commitVoiceTurn(input);
      return;
    }
    const text = input.trim();
    if (!text || busyRef.current) return;
    setInput("");
    await sendText(text);
  }

  // ---------------------------------------------------------------- voice

  function resetVoiceDraft() {
    voiceDraftStateRef.current = createVoiceDraftState();
    voiceDraftRef.current = "";
    voiceBaseRef.current = "";
    voiceFoldedSegmentsRef.current = new Set();
  }

  function tearDownVoiceSession() {
    voiceModeRef.current = false;
    voicePausedRef.current = false;
    cancelTalkback();
    const session = voiceSessionRef.current;
    voiceSessionRef.current = null;
    void session?.stop().catch(() => undefined);
    resetVoiceDraft();
    setVoicePhase("idle");
    // Stay warm for the next tap.
    prefetchVoiceCredentials(voiceInput());
  }

  async function resumeVoiceListening() {
    if (!voiceModeRef.current) return;
    resetVoiceDraft();
    // Keep anything typed while Savvy was answering; speech continues after it.
    voiceBaseRef.current = inputRef.current;
    voicePausedRef.current = false;
    setVoicePhase("listening");
    try {
      await voiceSessionRef.current?.setMicEnabled(true);
    } catch {
      /* onError already surfaced it */
    }
  }

  /** Send what's in the composer (spoken and/or edited), then listen again. */
  async function commitVoiceTurn(raw: string) {
    const text = raw.trim();
    if (!voiceModeRef.current || voicePausedRef.current || !text || busyRef.current) return;

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

  /** Live transcript → composer. Nothing is sent until Enter / Send. */
  function applyVoiceTranscript(
    text: string,
    meta?: { isFinal?: boolean; segmentId?: string },
  ) {
    if (!voiceModeRef.current || voicePausedRef.current) return;
    if (meta?.segmentId && voiceFoldedSegmentsRef.current.has(meta.segmentId)) return;
    const draft = applyVoiceSegment(voiceDraftStateRef.current, text, meta);
    voiceDraftRef.current = draft;
    setInput(joinDraft(voiceBaseRef.current, draft));
  }

  /** The user edited the composer while talking: keep their text, keep listening. */
  function editWhileListening(value: string) {
    for (const key of voiceDraftStateRef.current.segments.keys()) {
      voiceFoldedSegmentsRef.current.add(key);
    }
    voiceDraftStateRef.current = createVoiceDraftState();
    voiceDraftRef.current = "";
    voiceBaseRef.current = value;
    setInput(value);
  }

  async function startVoice() {
    if (busyRef.current) return;
    if (!isVoiceSessionSupported()) {
      setError("Voice needs a browser with microphone access (HTTPS).");
      return;
    }
    setError(null);
    resetVoiceDraft();
    // Keep anything already typed; speech continues after it.
    voiceBaseRef.current = input;
    voiceModeRef.current = true;
    voicePausedRef.current = false;
    // No loader: the mic opens in a few hundred ms and records from the start.
    setVoicePhase("listening");

    try {
      const session = await startVoiceSession({
        ...voiceInput(),
        playAgentAudio: false,
        handlers: {
          onStatus: (s) => {
            if (!voiceModeRef.current || voicePausedRef.current) return;
            if (s === "reconnecting") setVoicePhase("reconnecting");
            else if (s === "ready") setVoicePhase("listening");
          },
          onTranscript: (role, text, meta) => {
            if (role === "user") applyVoiceTranscript(text, meta);
          },
          onError: (message) => {
            if (!voiceModeRef.current) return;
            tearDownVoiceSession();
            setError(message);
          },
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
        // User tapped stop before the mic opened.
        await session.stop();
        return;
      }
      voiceSessionRef.current = session;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Voice failed to start";
      tearDownVoiceSession();
      setError(message);
      toast.error(message);
    }
  }

  /** ■ stops listening and leaves the text in the composer to review or send. */
  function stopVoice() {
    tearDownVoiceSession();
  }

  function onVoice() {
    if (voiceModeRef.current) stopVoice();
    else void startVoice();
  }

  // Release mic + room if the panel unmounts (e.g. floating Copilot closed).
  useEffect(() => {
    return () => {
      voiceModeRef.current = false;
      cancelTalkback();
      void voiceSessionRef.current?.stop().catch(() => undefined);
      voiceSessionRef.current = null;
    };
  }, []);

  const micDisabled = !voiceSupported || (busy && !voiceActive);

  return (
    <Card
      className={
        compact ? "flex h-[min(560px,calc(100vh-7rem))] flex-col" : "flex h-[70vh] flex-col"
      }
    >
      <CardHeader
        title="Trade Copilot · Savvy"
        description="Ask about the live book, or tell it what happened on WhatsApp or a call"
      />
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-2 text-sm text-zinc-500">
            <p>
              Ask about any deal or PO, a buyer, factory or teammate, payments,
              shipments, or what needs attention.
            </p>
            <p className="text-xs">
              Try: “Summarize PO 15269”, “Which deals have overdue payments?”,
              “Show Swastik deals in booking”, “What needs attention today?”
              {dealId ? ", “Summarize this deal”" : ""}
            </p>
            {voiceSupported ? (
              <p className="text-xs">
                Or tap the mic and just ask — Savvy will answer out loud.
              </p>
            ) : null}
            <div className="du-intro">
              <p className="du-intro-title">
                <NotebookPen className="h-3.5 w-3.5" aria-hidden />
                Heard something on WhatsApp or a call?
              </p>
              <p className="text-xs">
                Tell Savvy and it updates the deal — payments go into the ledger, everything else
                becomes a team note. You always confirm first.
              </p>
              <div className="du-examples">
                {UPDATE_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="du-example"
                    onClick={() => {
                      setInput(ex);
                      composerRef.current?.focus();
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-teal-50 px-3 py-2 text-sm text-zinc-800"
                : m.proposal
                  ? "space-y-2"
                  : "mr-8 rounded-lg bg-zinc-100 px-3 py-2.5"
            }
          >
            {m.role === "assistant" && m.proposal ? (
              <>
                <div className="mr-8 rounded-lg bg-zinc-100 px-3 py-2.5">
                  <MarkdownMessage content={m.content} />
                </div>
                <DealUpdateCard
                  proposal={m.proposal}
                  state={m.card || { status: "draft" }}
                  onState={(card) => setCard(i, card)}
                />
              </>
            ) : m.role === "assistant" ? (
              m.content ? (
                <>
                  <MarkdownMessage content={m.content} />
                  {m.deals?.length && !(busy && i === messages.length - 1) ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.deals.slice(0, 4).map((d) => (
                        <Link
                          key={d.id}
                          href={d.href}
                          title={d.title}
                          className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-800 transition hover:bg-teal-50"
                        >
                          Open {d.code}
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : busy && i === messages.length - 1 ? (
                <span className="text-sm text-zinc-500">Looking it up…</span>
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
          {voicePhase === "speaking" ? (
            <Volume2 className="h-3.5 w-3.5" />
          ) : (
            <span className="relative flex h-2 w-2">
              {voicePhase === "listening" || voicePhase === "reconnecting" ? (
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
          ref={composerRef}
          value={input}
          onChange={(e) => {
            // Editing while talking is allowed — the transcript continues after it.
            if (voiceModeRef.current && !voicePausedRef.current) editWhileListening(e.target.value);
            else setInput(e.target.value);
          }}
          disabled={voiceActive && busy}
          placeholder={
            voiceActive ? "Listening… speak, then press Enter" : "Ask, or tell Savvy an update…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          onClick={onVoice}
          disabled={micDisabled}
          aria-label={voiceActive ? "Stop voice" : "Speak to Copilot"}
          aria-pressed={voiceActive}
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
          {voiceActive ? (
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

/** Deal open on screen (/deals/[id]) so "this deal" works from the floating panel. */
function useDealOnScreen(): string | undefined {
  const pathname = usePathname() || "";
  const m = /^\/deals\/([^/?#]+)/.exec(pathname);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function FloatingCopilot() {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; at: number } | undefined>();
  const dealOnScreen = useDealOnScreen();

  // "Log an update" on Command Center / the deal page opens Copilot here.
  useEffect(
    () =>
      onOpenCopilot((d) => {
        setOpen(true);
        if (d.prefill != null) setPrefill({ text: d.prefill, at: Date.now() });
      }),
    [],
  );

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
          <CopilotPanel compact dealId={dealOnScreen} prefill={prefill} />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="fab"
        >
          <MessageSquare className="h-4 w-4" />
          Copilot
        </button>
      )}
    </div>
  );
}
