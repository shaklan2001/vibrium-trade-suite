"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  CornerUpLeft,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  INBOX_OUTCOME_LABELS,
  type InboxItem,
  type InboxMessage,
  type InboxOutcome,
  type ReplyDraft,
} from "@/lib/mail/inboxTypes";
import { avatarFor, displayName, fullTime, listTime, OUTCOME_STYLE, snippet } from "./format";

export type SentReply = { body: string; at: string };
export type DraftStatus = "idle" | "writing" | "error";

export function OutcomeChip({ outcome }: { outcome: InboxOutcome }) {
  return (
    <span className={cn("inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", OUTCOME_STYLE[outcome])}>
      {INBOX_OUTCOME_LABELS[outcome]}
    </span>
  );
}

function Avatar({ m, size = "h-9 w-9" }: { m: InboxMessage; size?: string }) {
  const a = avatarFor(m.fromName, m.from);
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white", size)}
      style={{ background: m.internal ? "#0f766e" : a.color }}
      aria-hidden
    >
      {a.initial}
    </span>
  );
}

function AgentCard({
  item,
  outcome,
  dealHref,
  dealCode,
  sent,
}: {
  item: InboxItem;
  outcome: InboxOutcome;
  dealHref: string | null;
  dealCode: string | null;
  sent: SentReply | null;
}) {
  return (
    <section className="rounded-lg border border-teal-200 bg-gradient-to-b from-teal-50/70 to-white p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-800">
          <Sparkles className="h-3.5 w-3.5" /> Vibrium agent · {item.agentName}
          {item.agentId ? <span className="font-normal normal-case text-teal-700/70">({item.agentId})</span> : null}
        </p>
        {dealHref ? (
          <Link href={dealHref} className="text-xs font-medium text-teal-700 hover:underline">
            Open deal{dealCode ? ` ${dealCode}` : ""} →
          </Link>
        ) : null}
      </div>
      {item.summary ? <p className="mt-2 text-sm leading-relaxed text-zinc-700">{item.summary}</p> : null}

      {item.facts.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.facts.map((f) => (
            <span key={f.label} className="rounded-md bg-white px-2 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200">
              {f.label}: <b className="font-medium text-zinc-900">{f.value}</b>
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm",
          sent || outcome === "replied"
            ? "bg-emerald-50 text-emerald-800"
            : outcome === "needs_you"
              ? "bg-amber-50 text-amber-900"
              : outcome === "draft_ready"
                ? "bg-white text-zinc-700 ring-1 ring-zinc-200"
                : "bg-zinc-50 text-zinc-600",
        )}
      >
        {sent ? (
          <>
            <Check className="mt-0.5 h-4 w-4 shrink-0" /> Reply sent {listTime(sent.at)}.
          </>
        ) : outcome === "needs_you" ? (
          <span>
            <strong>Check before sending:</strong> {item.note}
          </span>
        ) : outcome === "draft_ready" ? (
          <span>
            <strong>Reply drafted.</strong> Review it below and send.
          </span>
        ) : (
          <span>{item.note || "No reply needed."}</span>
        )}
      </div>
    </section>
  );
}

function OpenMessage({ m }: { m: InboxMessage }) {
  return (
    <article className="flex gap-3 px-1 py-3">
      <Avatar m={m} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-zinc-900">{displayName(m.fromName, m.from)}</span>{" "}
            <span className="text-xs text-zinc-500">&lt;{m.from}&gt;</span>
            <div className="truncate text-xs text-zinc-500">
              to {m.to || "us"}
              {m.cc ? `, cc ${m.cc}` : ""}
            </div>
          </div>
          <time className="shrink-0 text-xs text-zinc-500">{fullTime(m.date)}</time>
        </div>
        <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800">{m.body}</div>
        {m.attachments.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200">
                <Paperclip className="h-3 w-3" /> {a}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function CollapsedMessage({ m, onOpen }: { m: InboxMessage; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-zinc-50">
      <Avatar m={m} size="h-7 w-7 text-xs" />
      <span className="w-36 shrink-0 truncate text-sm font-medium text-zinc-800">{displayName(m.fromName, m.from)}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-500">{snippet(m.body, 140)}</span>
      <time className="shrink-0 text-xs text-zinc-400">{listTime(m.date)}</time>
    </button>
  );
}

function DraftEditor({
  draft,
  status,
  sendLabel,
  sending,
  saveDraftLabel,
  onChange,
  onRewrite,
  onSend,
  onSaveDraft,
}: {
  draft: ReplyDraft;
  status: DraftStatus;
  sendLabel: string;
  sending?: "send" | "draft" | null;
  saveDraftLabel?: string;
  onChange: (body: string) => void;
  onRewrite: () => void;
  onSend: () => void;
  onSaveDraft?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const writing = status === "writing";
  const busy = writing || Boolean(sending);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-zinc-200 bg-white shadow-sm" aria-label="Drafted reply">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-sm">
        <CornerUpLeft className="h-4 w-4 text-zinc-400" />
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-zinc-600">Draft</span>
        <span className="min-w-0 truncate text-zinc-700">
          To <b className="font-medium">{draft.toName || draft.to}</b>{" "}
          <span className="text-zinc-400">&lt;{draft.to}&gt;</span>
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-teal-700">
          <Sparkles className="h-3.5 w-3.5" />
          {writing
            ? "Copilot is writing…"
            : draft.by === "copilot"
              ? "Written by Vibrium Copilot"
              : status === "error"
                ? "Quick draft (Copilot unavailable)"
                : "Quick draft from the deal facts"}
        </span>
      </div>
      <p className="border-b border-zinc-100 px-4 py-2 text-sm text-zinc-600">{draft.subject}</p>
      <textarea
        className={cn(
          "block min-h-[240px] w-full resize-y px-4 py-3 text-sm leading-relaxed text-zinc-800 outline-none",
          writing && "animate-pulse text-zinc-400",
        )}
        value={draft.body}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Reply text"
        disabled={writing}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-2.5">
        <button
          type="button"
          onClick={onSend}
          disabled={busy || !draft.body.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-teal-800 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> {sending === "send" ? "Sending…" : sendLabel}
        </button>
        {onSaveDraft ? (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy || !draft.body.trim()}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            <Inbox className="h-3.5 w-3.5" /> {sending === "draft" ? "Saving…" : saveDraftLabel || "Save as draft"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRewrite}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", writing && "animate-spin")} /> Rewrite with Copilot
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}

function SentCard({ to, sent }: { to: string; sent: SentReply }) {
  return (
    <section className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40" aria-label="Sent reply">
      <div className="flex flex-wrap items-center gap-2 border-b border-emerald-100 px-4 py-2.5 text-sm">
        <CornerUpLeft className="h-4 w-4 text-emerald-600" />
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-800">Sent</span>
        <span className="text-zinc-700">to {to}</span>
        <time className="ml-auto text-xs text-zinc-500">{fullTime(sent.at)}</time>
      </div>
      <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-zinc-800">{sent.body}</div>
    </section>
  );
}

export function InboxView({
  item,
  outcome,
  dealHref,
  dealCode,
  position,
  draft,
  draftStatus,
  sent,
  sendLabel,
  sending,
  saveDraftLabel,
  onBack,
  onStep,
  onChangeDraft,
  onRewrite,
  onSend,
  onSaveDraft,
}: {
  item: InboxItem;
  outcome: InboxOutcome;
  dealHref: string | null;
  dealCode: string | null;
  position: { index: number; total: number };
  draft: ReplyDraft | null;
  draftStatus: DraftStatus;
  sent: SentReply | null;
  sendLabel: string;
  sending?: "send" | "draft" | null;
  saveDraftLabel?: string;
  onBack: () => void;
  onStep: (dir: -1 | 1) => void;
  onChangeDraft: (body: string) => void;
  onRewrite: () => void;
  onSend: () => void;
  onSaveDraft?: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const older = item.thread.slice(0, -1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-100 px-2 py-1.5">
        <button type="button" onClick={onBack} className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100" aria-label="Back to inbox">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="ml-auto text-xs text-zinc-500">
          {position.index + 1} of {position.total}
        </span>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={position.index <= 0}
          className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
          aria-label="Newer"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={position.index >= position.total - 1}
          className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
          aria-label="Older"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-1 text-lg font-semibold text-zinc-900">{item.subject}</h2>
          <OutcomeChip outcome={outcome} />
          {item.poNumbers.slice(0, 2).map((po) => (
            <span key={po} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
              PO {po}
            </span>
          ))}
        </header>

        <AgentCard item={item} outcome={outcome} dealHref={dealHref} dealCode={dealCode} sent={sent} />

        <div className="mt-4 divide-y divide-zinc-100">
          {older.map((m) =>
            expanded.has(m.id) ? (
              <OpenMessage key={m.id} m={m} />
            ) : (
              <CollapsedMessage key={m.id} m={m} onOpen={() => setExpanded((s) => new Set(s).add(m.id))} />
            ),
          )}
          <OpenMessage m={item.latest} />
        </div>

        {sent ? <SentCard to={item.latest.from} sent={sent} /> : null}
        {!sent && draft ? (
          <DraftEditor
            draft={draft}
            status={draftStatus}
            sendLabel={sendLabel}
            sending={sending}
            saveDraftLabel={saveDraftLabel}
            onChange={onChangeDraft}
            onRewrite={onRewrite}
            onSend={onSend}
            onSaveDraft={onSaveDraft}
          />
        ) : null}
      </div>
    </div>
  );
}
