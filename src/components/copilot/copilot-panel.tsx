"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { MarkdownMessage } from "@/components/copilot/markdown-message";
import { MessageSquare, X } from "lucide-react";

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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);

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
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Chat failed (${res.status})`);
      }
      await readStreamText(res, (full) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: full };
          return copy;
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

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
      <div className="flex gap-2 border-t border-zinc-100 p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Savvy about Trade Suite…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <Button onClick={() => void send()} disabled={busy}>
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
