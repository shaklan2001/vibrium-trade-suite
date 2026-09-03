"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { MessageSquare, X } from "lucide-react";

async function readStreamText(res: Response, onChunk: (t: string) => void) {
  if (!res.body) {
    const t = await res.text();
    onChunk(t);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    // Handle SSE data: lines or raw text
    const lines = chunk.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const piece =
            json.reply ||
            json.message ||
            json.delta ||
            json.content ||
            (typeof json === "string" ? json : "");
          if (piece) {
            full += piece;
            onChunk(full);
          }
        } catch {
          full += payload;
          onChunk(full);
        }
      } else {
        full += trimmed;
        onChunk(full);
      }
    }
  }
  if (!full) {
    // non-SSE full body
  }
}

export function CopilotPanel({
  compact = false,
  dealId,
}: {
  compact?: boolean;
  dealId?: string;
}) {
  const deal = useTradeStore((s) =>
    dealId ? s.deals.find((d) => d.id === dealId) : s.deals[0],
  );
  const routing = useTradeStore((s) => s.routing);
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

    const context = deal
      ? `\n\n[Current deal context]\nTitle: ${deal.title}\nStage: ${deal.stage}\nRequirement: ${JSON.stringify(deal.requirement || {})}\nSelected SKUs: ${deal.quote?.skus.filter((s) => s.selected).length || 0}\n`
      : "";

    try {
      await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          botId: routing.ops_copilot || undefined,
        }),
      }).catch(() => null);

      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          botId: routing.ops_copilot || undefined,
          message: text + context,
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
    <Card className={compact ? "flex h-[420px] flex-col" : "flex h-[70vh] flex-col"}>
      <CardHeader
        title="Ops Copilot"
        description="Ask about the current deal or Phase A next steps"
      />
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Try: “Summarize this requirement and who we should outreach.”
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-teal-50 px-3 py-2 text-sm"
                : "mr-8 rounded-lg bg-zinc-100 px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            {m.content || (busy && i === messages.length - 1 ? "…" : "")}
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
          placeholder="Ask the copilot…"
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
        <div className="mb-2 w-[360px]">
          <div className="mb-1 flex justify-end">
            <button
              className="rounded-full bg-white p-1 shadow border border-zinc-200"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <CopilotPanel compact />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-teal-800"
        >
          <MessageSquare className="h-4 w-4" />
          Copilot
        </button>
      )}
    </div>
  );
}
