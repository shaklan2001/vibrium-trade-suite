"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { MarkdownMessage } from "@/components/copilot/markdown-message";
import { useTradeStore } from "@/lib/trade/store";
import { buildAgentDealPack } from "@/lib/trade/agentDealPack";
import { MessageSquare, X } from "lucide-react";
import { useWorkspaceProcess } from "@/components/layout/workspace-process";

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
    // SSE events are separated by blank lines; keep incomplete trailing chunk
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
        // Non-SSE fallback — preserve original line breaks via trailing \n
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

function buildDealContext(deal: NonNullable<ReturnType<typeof useTradeStore.getState>["deals"][0]>) {
  return `

[Current deal context]
Title: ${deal.title}
Stage: ${deal.stage}
Flagship deal: ${deal.showcase ? "yes" : "no"}
Parties: ${deal.parties.map((p) => `${p.role}:${p.company || p.name}`).join("; ")}
Requirement: ${JSON.stringify(deal.requirement || {})}
Quote factory: ${deal.quote?.factoryName || "—"} · SKUs: ${deal.quote?.skus.length || 0} · selected: ${deal.quote?.skus.filter((s) => s.selected).length || 0}
Artwork: ${deal.artwork?.summary || "—"}
Samples: ${deal.samples?.summary || "—"}
PI: ${deal.pi?.docNumber || "—"} · PO: ${deal.po?.docNumber || "—"} · Discrepancy: ${deal.discrepancy?.summary || "—"}
Packaging: ${deal.packaging?.summary || deal.upcMatch?.summary || "—"}
Production: ${deal.production?.summary || "—"}
Inspection: ${deal.inspection?.summary || "—"}
Booking: ${deal.booking?.summary || "—"}
CBM: ${deal.cbm?.summary || "—"}
Docs pack: ${deal.docsPack?.summary || "—"}
Payment: ${deal.payment?.summary || "—"}
Commission: ${deal.commission?.summary || "—"}
Documents: ${deal.documents.map((d) => d.name).join(", ") || "none"}
`;
}

function buildCompanyPulseContext(deals: ReturnType<typeof useTradeStore.getState>["deals"]) {
  if (!deals.length) return "";
  const pack = buildAgentDealPack(deals);
  // Compact for chat context limits
  const compact = {
    asOf: pack.asOf,
    deals: pack.deals.map((d) => ({
      id: d.id,
      code: d.code,
      title: d.title,
      stage: d.stage,
      payment: d.payment?.status,
      docsMissing: d.docsPack?.missing,
      productionBlockers: d.production?.blockers,
      discrepancyAligned: d.discrepancyAligned,
      urgency: d.urgency,
    })),
  };
  return `

[Company book — raw deal snapshots for grounding]
${JSON.stringify(compact)}
`;
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
  const deals = useTradeStore((s) => s.deals);
  const routing = useTradeStore((s) => s.routing);
  const botId = routing.ops_copilot || "VB00000323";
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

    const context =
      (deal ? buildDealContext(deal) : "") + buildCompanyPulseContext(deals);

    try {
      await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, botId }),
      }).catch(() => null);

      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          botId,
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
    <Card
      className={
        compact ? "flex h-[420px] flex-col" : "flex h-[70vh] flex-col"
      }
    >
      <CardHeader
        title="Ops Copilot · Savvy"
        description={`Trade Suite guide (${botId}) — Command Center pulse, deals, stages, agents`}
      />
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-2 text-sm text-zinc-500">
            <p>Ask about attention items, today&apos;s todos, or a deal stage.</p>
            <p className="text-xs">
              Try: “What needs my attention today?”, “What is this platform?”,
              “What’s next on this deal?”
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
  const { processId } = useWorkspaceProcess();
  if (processId !== "ops") return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open ? (
        <div className="mb-2 w-[360px]">
          <div className="mb-1 flex justify-end">
            <button
              className="rounded-full border border-zinc-200 bg-white p-1 shadow"
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
