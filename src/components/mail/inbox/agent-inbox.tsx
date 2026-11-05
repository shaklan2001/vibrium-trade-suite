"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { slugId } from "@/lib/trade/processedDealMapper";
import { useTradeStore } from "@/lib/trade/store";
import {
  INBOX_OUTCOME_LABELS,
  INBOX_OUTCOME_ORDER,
  type InboxItem,
  type InboxOutcome,
  type InboxSource,
  type ReplyDraft,
} from "@/lib/mail/inboxTypes";
import { ListSkeleton } from "@/components/ui/loading-block";
import { ConnectPanel, PROVIDER_LABELS, ProviderMark, type MailProvider } from "./connect-panel";
import { displayName, listTime, snippet } from "./format";
import { InboxView, OutcomeChip, type DraftStatus, type SentReply } from "./inbox-view";

/**
 * Showcase mode: "connect" is simulated and the mailbox is filled from real
 * deal-book threads; Send records the reply locally. Switch to "live" once a
 * mailbox is connected for real (/mailbox/connections) and Gmail send is on.
 */
const SOURCE: InboxSource = "book";
const MAILBOX_ADDRESS = "ops@snspl.in";
const SIGN_IN_MS = 1400;
/** Gap between mails being picked up after connecting. */
const READ_GAP_MS = 280;

type Folder = "all" | InboxOutcome;
type Mailbox = { provider: MailProvider; address: string };

const MAILBOX_KEY = "vt-inbox-mailbox";
const READ_KEY = "vt-inbox-read";
const SENT_KEY = "vt-inbox-sent";

/** Per-viewer conveniences only — the page works without storage. */
function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveStored(key: string, value: unknown) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private window / blocked storage
  }
}

const DOT: Record<InboxOutcome, string> = {
  draft_ready: "bg-teal-500",
  needs_you: "bg-amber-500",
  waiting: "bg-sky-500",
  replied: "bg-emerald-500",
  fyi: "bg-zinc-400",
};

export function AgentInbox() {
  const [hydrated, setHydrated] = useState(false);
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string[]>([]);
  const [folder, setFolder] = useState<Folder>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [sent, setSent] = useState<Record<string, SentReply>>({});
  const [drafts, setDrafts] = useState<Record<string, ReplyDraft>>({});
  const [draftStatus, setDraftStatus] = useState<Record<string, DraftStatus>>({});
  const timers = useRef<number[]>([]);
  const deals = useTradeStore((s) => s.deals);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const load = useCallback(async (arrive: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mail/inbox?source=${SOURCE}&limit=30`, { cache: "no-store" });
      const body = (await res.json()) as { items?: InboxItem[]; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const next = body.items || [];
      setItems(next);
      if (arrive) {
        // Mail lands as "reading", then each agent finishes in turn.
        clearTimers();
        setReading(next.map((i) => i.id));
        next.forEach((item, i) => {
          timers.current.push(
            window.setTimeout(() => setReading((r) => r.filter((id) => id !== item.id)), 600 + i * READ_GAP_MS),
          );
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = loadStored<Mailbox | null>(MAILBOX_KEY, null);
    setMailbox(saved);
    setRead(loadStored<string[]>(READ_KEY, []));
    setSent(loadStored<Record<string, SentReply>>(SENT_KEY, {}));
    setHydrated(true);
    if (saved) void load(false);
    return clearTimers;
  }, [load]);

  async function connect(provider: MailProvider) {
    await new Promise((r) => window.setTimeout(r, SIGN_IN_MS));
    const next = { provider, address: MAILBOX_ADDRESS };
    setMailbox(next);
    saveStored(MAILBOX_KEY, next);
    toast.success(`${PROVIDER_LABELS[provider].name} connected — agents are reading your inbox`);
    void load(true);
  }

  function disconnect() {
    clearTimers();
    setAccountOpen(false);
    setMailbox(null);
    setItems([]);
    setOpenId(null);
    setReading([]);
    saveStored(MAILBOX_KEY, null);
  }

  const outcomeOf = useCallback(
    (item: InboxItem): InboxOutcome => (sent[item.id] ? "replied" : item.outcome),
    [sent],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (folder !== "all" && (reading.includes(item.id) || outcomeOf(item) !== folder)) return false;
      if (!needle) return true;
      return [item.subject, item.latest.from, item.latest.fromName, item.latest.body, item.poNumbers.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [items, folder, query, outcomeOf, reading]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of items) {
      if (reading.includes(item.id)) continue;
      c[outcomeOf(item)] = (c[outcomeOf(item)] || 0) + 1;
    }
    return c;
  }, [items, outcomeOf, reading]);
  const unread = items.filter((i) => !read.includes(i.id)).length;

  const openItem = openId ? items.find((i) => i.id === openId) || null : null;
  const openIndex = openItem ? visible.findIndex((i) => i.id === openItem.id) : -1;

  const rewrite = useCallback(async (item: InboxItem) => {
    if (!item.draft) return;
    setDraftStatus((s) => ({ ...s, [item.id]: "writing" }));
    try {
      const res = await fetch("/api/mail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const body = (await res.json()) as { draft?: ReplyDraft; error?: string };
      if (!res.ok || !body.draft) throw new Error(body.error || `HTTP ${res.status}`);
      setDrafts((d) => ({ ...d, [item.id]: body.draft! }));
      setDraftStatus((s) => ({ ...s, [item.id]: "idle" }));
    } catch {
      setDraftStatus((s) => ({ ...s, [item.id]: "error" }));
    }
  }, []);

  function open(item: InboxItem) {
    if (reading.includes(item.id)) return;
    setOpenId(item.id);
    if (!read.includes(item.id)) {
      const next = [...read, item.id].slice(-500);
      setRead(next);
      saveStored(READ_KEY, next);
    }
    // The agent writes the reply as soon as the mail is opened.
    if (item.draft && !drafts[item.id] && !draftStatus[item.id] && !sent[item.id]) void rewrite(item);
  }

  function send(item: InboxItem) {
    const draft = drafts[item.id] || item.draft;
    if (!draft) return;
    const next = { ...sent, [item.id]: { body: draft.body, at: new Date().toISOString() } };
    setSent(next);
    saveStored(SENT_KEY, next);
    toast.success(`Reply sent to ${displayName(draft.toName, draft.to)}`);
  }

  if (!hydrated) return <ListSkeleton rows={6} />;
  if (!mailbox) return <ConnectPanel mailboxAddress={MAILBOX_ADDRESS} onConnect={connect} />;

  const folders: { id: Folder; label: string; count: number }[] = [
    { id: "all", label: "Inbox", count: unread },
    ...INBOX_OUTCOME_ORDER.map((o) => ({ id: o as Folder, label: INBOX_OUTCOME_LABELS[o], count: counts[o] || 0 })),
  ];
  const provider = PROVIDER_LABELS[mailbox.provider];

  return (
    <div className="flex h-[calc(100vh-12.5rem)] min-h-[540px] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
        <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-zinc-800">
          <ProviderMark provider={mailbox.provider} className="h-6 w-6" />
          {provider.name}
        </span>
        <label className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-600 focus-within:bg-white focus-within:ring-1 focus-within:ring-teal-600">
          <Search className="h-4 w-4 shrink-0" />
          <span className="sr-only">Search mail</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenId(null);
            }}
            placeholder="Search mail, sender or PO"
            className="w-full bg-transparent outline-none"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        {reading.length ? (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 sm:flex">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Agents reading {reading.length}
          </span>
        ) : null}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
            aria-label={`Account ${mailbox.address}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white"
          >
            {mailbox.address[0]!.toUpperCase()}
          </button>
          {accountOpen ? (
            <div className="absolute right-0 top-10 z-20 w-64 rounded-lg border border-zinc-200 bg-white p-4 text-sm shadow-lg">
              <strong className="block text-zinc-900">Sourcing desk</strong>
              <span className="block text-zinc-600">{mailbox.address}</span>
              <small className="mt-1 block text-xs text-zinc-500">Connected through {provider.via}.</small>
              <button
                type="button"
                onClick={disconnect}
                className="mt-3 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-zinc-100 p-2 md:flex" aria-label="Folders">
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFolder(f.id);
                setOpenId(null);
              }}
              className={cn(
                "flex items-center justify-between rounded-r-full px-3 py-1.5 text-left text-sm",
                folder === f.id ? "bg-teal-50 font-semibold text-teal-900" : "text-zinc-700 hover:bg-zinc-50",
              )}
            >
              <span className="flex items-center gap-2">
                {f.id === "all" ? <Inbox className="h-4 w-4" /> : <span className={cn("h-2 w-2 rounded-full", DOT[f.id])} />}
                {f.label}
              </span>
              {f.count ? <span className="text-xs text-zinc-500">{f.count}</span> : null}
            </button>
          ))}
          <p className="mt-auto px-3 pb-1 text-[11px] leading-snug text-zinc-400">
            <Sparkles className="mr-1 inline h-3 w-3" />
            Each mail is read by its stage agent; replies are written by Vibrium Copilot.
          </p>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {openItem ? (
            <InboxView
              item={openItem}
              outcome={outcomeOf(openItem)}
              dealHref={`/deals/${encodeURIComponent(slugId(openItem.id))}`}
              dealCode={deals.find((d) => d.mailboxSourceId === openItem.id)?.code || null}
              position={{ index: Math.max(openIndex, 0), total: Math.max(visible.length, 1) }}
              draft={drafts[openItem.id] || openItem.draft}
              draftStatus={draftStatus[openItem.id] || "idle"}
              sent={sent[openItem.id] || null}
              sendLabel="Send"
              onBack={() => setOpenId(null)}
              onStep={(dir) => {
                const next = visible[openIndex + dir];
                if (next) open(next);
              }}
              onChangeDraft={(body) =>
                setDrafts((d) => ({ ...d, [openItem.id]: { ...(d[openItem.id] || openItem.draft!), body } }))
              }
              onRewrite={() => void rewrite(openItem)}
              onSend={() => send(openItem)}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => void load(false)}
                  disabled={loading}
                  className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
                  aria-label="Refresh"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </button>
                {/* Folder pills on small screens */}
                <div className="flex gap-1.5 overflow-x-auto md:hidden">
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFolder(f.id)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs",
                        folder === f.id ? "bg-teal-700 text-white" : "border border-zinc-200 text-zinc-600",
                      )}
                    >
                      {f.label} {f.count || ""}
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-zinc-500">
                  {visible.length ? `1–${visible.length} of ${visible.length}` : "0"}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading && !items.length ? (
                  <div className="p-4">
                    <p className="mb-3 flex items-center gap-1.5 text-sm text-zinc-500">
                      <Sparkles className="h-4 w-4 animate-pulse text-teal-600" /> Syncing your inbox…
                    </p>
                    <ListSkeleton rows={8} />
                  </div>
                ) : error ? (
                  <p className="p-6 text-sm text-red-700">{error}</p>
                ) : visible.length === 0 ? (
                  <p className="p-8 text-center text-sm text-zinc-500">
                    {query || folder !== "all" ? "Nothing here right now." : "Waiting for the first mail…"}
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {visible.map((item) => {
                      const isReading = reading.includes(item.id);
                      const unreadRow = !read.includes(item.id);
                      const outcome = outcomeOf(item);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => open(item)}
                            disabled={isReading}
                            className={cn(
                              "flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50 hover:shadow-[inset_3px_0_0_#0f766e] disabled:cursor-progress",
                              !unreadRow && "bg-zinc-50/40",
                              !isReading && outcome === "fyi" && "opacity-70",
                            )}
                          >
                            <span
                              className={cn(
                                "w-40 shrink-0 truncate text-sm",
                                unreadRow ? "font-semibold text-zinc-900" : "text-zinc-700",
                              )}
                            >
                              {displayName(item.latest.fromName, item.latest.from)}
                              {item.thread.length > 1 ? (
                                <span className="ml-1 text-xs font-normal text-zinc-400">{item.thread.length}</span>
                              ) : null}
                            </span>
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              {isReading ? (
                                <span className="inline-flex shrink-0 animate-pulse items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-700 ring-1 ring-inset ring-teal-200">
                                  <Sparkles className="h-3 w-3" /> Agent reading…
                                </span>
                              ) : (
                                <>
                                  <OutcomeChip outcome={outcome} />
                                  <span className="hidden shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 lg:inline">
                                    {item.agentName}
                                  </span>
                                </>
                              )}
                              <span className={cn("truncate text-sm", unreadRow ? "font-semibold text-zinc-900" : "text-zinc-800")}>
                                {item.subject}
                              </span>
                              <span className="hidden truncate text-sm text-zinc-500 sm:inline">
                                – {snippet(item.latest.body, 140)}
                              </span>
                            </span>
                            <time className={cn("shrink-0 text-xs", unreadRow ? "font-semibold text-zinc-900" : "text-zinc-500")}>
                              {listTime(item.latest.date)}
                            </time>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
