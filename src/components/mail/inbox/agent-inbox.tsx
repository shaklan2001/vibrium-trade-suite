"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { slugId } from "@/lib/trade/processedDealMapper";
import { useTradeStore } from "@/lib/trade/store";
import { syncMailNow } from "@/lib/mail/client";
import {
  INBOX_OUTCOME_LABELS,
  INBOX_OUTCOME_ORDER,
  type InboxCursor,
  type InboxItem,
  type InboxMailbox,
  type InboxOutcome,
  type ReplyDraft,
} from "@/lib/mail/inboxTypes";
import { ListSkeleton } from "@/components/ui/loading-block";
import { ConnectPanel } from "./connect-panel";
import { displayName, listTime, snippet } from "./format";
import { InboxView, OutcomeChip, type DraftStatus, type SentReply } from "./inbox-view";

/**
 * The shared team inbox. Every connected mailbox is synced into the store; this
 * page reads it a page at a time (keyset paging, so every mail is reachable),
 * switches between "All mailboxes" and one member, drafts replies with Vibrium
 * Copilot and sends them from the member's own address.
 */

type Folder = "all" | InboxOutcome;
type SavedDraft = { draftId: string | null };
type InboxResponse = {
  mailboxes?: InboxMailbox[];
  items?: InboxItem[];
  nextCursor?: InboxCursor | null;
  error?: string;
  code?: string;
};

const ALL = "all";
const PAGE_SIZE = 40;
/** v2: the old demo inbox stored a {provider, address} object under "vt-inbox-mailbox". */
const CHOSEN_KEY = "vt-inbox-mailbox-v2";
const READ_KEY = "vt-inbox-read-v2";
const SENT_KEY = "vt-inbox-sent-v2";
/** Re-read the current page while the inbox is open (the sync runs every ~3 min). */
const REFRESH_MS = 60 * 1000;

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

function without<T>(map: Record<string, T>, key: string) {
  const rest = { ...map };
  delete rest[key];
  return rest;
}

/** A conversation is unread again when a newer mail arrives in it. */
const readKey = (item: InboxItem) => `${item.id}@${item.latest.date || ""}`;

function mailboxLabel(m: Pick<InboxMailbox, "displayName" | "email">) {
  return m.displayName || m.email.split("@")[0]!;
}

function syncState(m: InboxMailbox) {
  if (m.status === "reauth_required") return { dot: "bg-red-500", text: "password needed" };
  if (m.status === "error") return { dot: "bg-amber-500", text: "sync error" };
  if (m.status === "paused") return { dot: "bg-zinc-400", text: "paused" };
  if (!m.lastSyncAt) return { dot: "bg-sky-500 animate-pulse", text: "importing…" };
  return { dot: "bg-emerald-500", text: "live" };
}

export function AgentInbox() {
  const [hydrated, setHydrated] = useState(false);
  const [mailboxes, setMailboxes] = useState<InboxMailbox[]>([]);
  const [scope, setScope] = useState<string>(ALL);
  const [items, setItems] = useState<InboxItem[]>([]);
  /** cursors[i] = where page i starts (page 0 starts at the top). */
  const [cursors, setCursors] = useState<(InboxCursor | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<InboxCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [sent, setSent] = useState<Record<string, SentReply>>({});
  const [drafts, setDrafts] = useState<Record<string, ReplyDraft>>({});
  const [draftStatus, setDraftStatus] = useState<Record<string, DraftStatus>>({});
  const [sending, setSending] = useState<Record<string, "send" | "draft">>({});
  const [savedDrafts, setSavedDrafts] = useState<Record<string, SavedDraft>>({});
  const deals = useTradeStore((s) => s.deals);
  const requestId = useRef(0);

  const load = useCallback(
    async (opts: { scope: string; cursor: InboxCursor | null; q: string; quiet?: boolean }) => {
      const id = ++requestId.current;
      if (!opts.quiet) setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({ mailbox: opts.scope, limit: String(PAGE_SIZE) });
        if (opts.q) sp.set("q", opts.q);
        if (opts.cursor) {
          sp.set("before_at", opts.cursor.at);
          sp.set("before_key", opts.cursor.key);
        }
        let res = await fetch(`/api/mail/inbox?${sp}`, { cache: "no-store" });
        let body = (await res.json()) as InboxResponse;
        if (id !== requestId.current) return; // a newer request superseded this one
        // The chosen mailbox was disconnected (or the choice is stale): show all mailboxes.
        if (res.status === 404 && body.code === "not_found" && opts.scope !== ALL) {
          setScope(ALL);
          saveStored(CHOSEN_KEY, ALL);
          sp.set("mailbox", ALL);
          sp.delete("before_at");
          sp.delete("before_key");
          res = await fetch(`/api/mail/inbox?${sp}`, { cache: "no-store" });
          body = (await res.json()) as InboxResponse;
          if (id !== requestId.current) return;
        }
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setMailboxes(body.mailboxes || []);
        setItems(body.items || []);
        setNextCursor(body.nextCursor || null);
      } catch (err) {
        if (id === requestId.current && !opts.quiet) setError(err instanceof Error ? err.message : "Could not load the inbox");
      } finally {
        if (id === requestId.current) {
          if (!opts.quiet) setLoading(false);
          setHydrated(true);
        }
      }
    },
    [],
  );

  // First load: ?mailbox= from Email connections, else the last choice.
  useEffect(() => {
    setRead(loadStored<string[]>(READ_KEY, []));
    setSent(loadStored<Record<string, SentReply>>(SENT_KEY, {}));
    const fromUrl = new URLSearchParams(window.location.search).get("mailbox");
    const saved = loadStored<unknown>(CHOSEN_KEY, ALL);
    const first = fromUrl || (typeof saved === "string" && saved ? saved : ALL);
    setScope(first);
    void load({ scope: first, cursor: null, q: "" });
  }, [load]);

  // A saved choice that no longer exists falls back to all mailboxes.
  useEffect(() => {
    if (!hydrated || scope === ALL || !mailboxes.length) return;
    if (!mailboxes.some((m) => m.id === scope)) {
      setScope(ALL);
      saveStored(CHOSEN_KEY, ALL);
      void load({ scope: ALL, cursor: null, q: query });
    }
  }, [hydrated, mailboxes, scope, query, load]);

  // Server-side search, debounced.
  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => {
      if (queryInput.trim() === query) return;
      const q = queryInput.trim();
      setQuery(q);
      setCursors([null]);
      setPageIndex(0);
      setOpenId(null);
      void load({ scope, cursor: null, q });
    }, 400);
    return () => window.clearTimeout(t);
  }, [queryInput, query, scope, hydrated, load]);

  // Keep the visible page fresh while the inbox is open.
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !openId) {
        void load({ scope, cursor: cursors[pageIndex] || null, q: query, quiet: true });
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hydrated, scope, cursors, pageIndex, query, openId, load]);

  function switchScope(next: string) {
    setSwitcherOpen(false);
    if (next === scope) return;
    setScope(next);
    saveStored(CHOSEN_KEY, next);
    setCursors([null]);
    setPageIndex(0);
    setOpenId(null);
    setItems([]);
    void load({ scope: next, cursor: null, q: query });
  }

  function goPage(dir: 1 | -1) {
    if (dir === 1 && !nextCursor) return;
    if (dir === -1 && pageIndex === 0) return;
    const index = pageIndex + dir;
    const nextCursors = dir === 1 ? [...cursors.slice(0, index), nextCursor] : cursors;
    setCursors(nextCursors);
    setPageIndex(index);
    setOpenId(null);
    void load({ scope, cursor: nextCursors[index] || null, q: query });
  }

  /** Pull new mail from the server(s) now, then re-read the page. */
  async function refresh() {
    setSyncing(true);
    try {
      const result = await syncMailNow({ connectionId: scope === ALL ? undefined : scope, maxRounds: 3 });
      if (result.errors.length) toast.error(result.errors[0]!);
      else if (result.ingested) toast.success(`${result.ingested} new mail${result.ingested === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
      setCursors([null]);
      setPageIndex(0);
      void load({ scope, cursor: null, q: query });
    }
  }

  async function connected(email: string) {
    await load({ scope: ALL, cursor: null, q: "" });
    toast.message(`Importing ${email} — new mail appears here as it syncs`);
    void syncMailNow({ maxRounds: 2 })
      .then(() => load({ scope: ALL, cursor: null, q: "" }))
      .catch(() => undefined);
  }

  const outcomeOf = useCallback(
    (item: InboxItem): InboxOutcome => (sent[readKey(item)] ? "replied" : item.outcome),
    [sent],
  );

  const visible = useMemo(
    () => (folder === "all" ? items : items.filter((item) => outcomeOf(item) === folder)),
    [items, folder, outcomeOf],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of items) c[outcomeOf(item)] = (c[outcomeOf(item)] || 0) + 1;
    return c;
  }, [items, outcomeOf]);
  const isUnread = useCallback((item: InboxItem) => !read.includes(readKey(item)), [read]);
  const unread = items.filter(isUnread).length;

  const openItem = openId ? items.find((i) => i.id === openId) || null : null;
  const openIndex = openItem ? visible.findIndex((i) => i.id === openItem.id) : -1;
  const current = scope === ALL ? null : mailboxes.find((m) => m.id === scope) || null;
  const byId = useMemo(() => new Map(mailboxes.map((m) => [m.id, m])), [mailboxes]);

  /** Load the whole conversation and let Copilot write the reply. */
  const rewrite = useCallback(async (item: InboxItem) => {
    setDraftStatus((s) => ({ ...s, [item.id]: "writing" }));
    try {
      const res = await fetch("/api/mail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadKey: item.mailbox.threadKey }),
      });
      const body = (await res.json()) as { item?: InboxItem; draft?: ReplyDraft | null; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.item) {
        // Whole thread + attachment names; keep the row id so local state stays attached.
        const fresh = { ...body.item, id: item.id };
        setItems((list) => list.map((i) => (i.id === item.id ? fresh : i)));
      }
      if (body.draft) setDrafts((d) => ({ ...d, [item.id]: body.draft! }));
      setDraftStatus((s) => ({ ...s, [item.id]: body.draft?.by === "copilot" ? "idle" : "error" }));
    } catch (err) {
      setDraftStatus((s) => ({ ...s, [item.id]: "error" }));
      toast.error(err instanceof Error ? err.message : "Could not write the reply");
    }
  }, []);

  function open(item: InboxItem) {
    setOpenId(item.id);
    const key = readKey(item);
    if (!read.includes(key)) {
      const next = [...read, key].slice(-2000);
      setRead(next);
      saveStored(READ_KEY, next);
    }
    if (!drafts[item.id] && !draftStatus[item.id] && !sent[key]) void rewrite(item);
  }

  /** Send or save the reply through the member's own mailbox. */
  async function reply(item: InboxItem, mode: "send" | "draft") {
    const draft = drafts[item.id] || item.draft;
    if (!draft || sending[item.id]) return;
    setSending((s) => ({ ...s, [item.id]: mode }));
    try {
      const res = await fetch("/api/mail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: item.mailbox.connectionId,
          messageId: item.mailbox.messageId,
          internetMessageId: item.mailbox.internetMessageId,
          body: draft.body,
          mode,
          draftId: savedDrafts[item.id]?.draftId || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { mailbox?: string; draftId?: string | null; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (mode === "draft") {
        setSavedDrafts((d) => ({ ...d, [item.id]: { draftId: body.draftId || null } }));
        toast.success(`Saved to Drafts in ${body.mailbox}`);
      } else {
        const next = { ...sent, [readKey(item)]: { body: draft.body, at: new Date().toISOString() } };
        setSent(next);
        saveStored(SENT_KEY, next);
        setSavedDrafts((d) => without(d, item.id));
        toast.success(`Sent from ${body.mailbox} to ${displayName(draft.toName, draft.to)}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reach the mail server", { duration: 10_000 });
    } finally {
      setSending((s) => without(s, item.id));
    }
  }

  if (!hydrated) return <ListSkeleton rows={6} />;
  if (!mailboxes.length && !error) return <ConnectPanel onConnected={(email) => void connected(email)} />;

  const folders: { id: Folder; label: string; count: number }[] = [
    { id: "all", label: "Inbox", count: unread },
    ...INBOX_OUTCOME_ORDER.map((o) => ({ id: o as Folder, label: INBOX_OUTCOME_LABELS[o], count: counts[o] || 0 })),
  ];
  const first = pageIndex * PAGE_SIZE + 1;
  const pageLabel = items.length ? `${first}–${first + items.length - 1}` : "0";

  return (
    <div className="flex h-[calc(100vh-12.5rem)] min-h-[540px] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-2.5">
        {/* Mailbox switcher: all members, or one person's mailbox */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            aria-expanded={switcherOpen}
            aria-haspopup="listbox"
            className="flex max-w-[16rem] items-center gap-2 rounded-full border border-zinc-200 py-1 pl-1 pr-3 text-sm hover:bg-zinc-50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">
              {current ? mailboxLabel(current)[0]!.toUpperCase() : <Users className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 truncate font-medium text-zinc-800">
              {current ? mailboxLabel(current) : `All mailboxes (${mailboxes.length})`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          </button>
          {switcherOpen ? (
            <div
              role="listbox"
              aria-label="Mailbox"
              className="absolute left-0 top-11 z-20 max-h-[60vh] w-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1.5 text-sm shadow-lg"
            >
              {[{ id: ALL } as const, ...mailboxes].map((m) => {
                const isAll = m.id === ALL;
                const mb = isAll ? null : (m as InboxMailbox);
                const state = mb ? syncState(mb) : null;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={scope === m.id}
                    onClick={() => switchScope(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-zinc-50",
                      scope === m.id && "bg-teal-50/70",
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
                      {mb ? mailboxLabel(mb)[0]!.toUpperCase() : <Users className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-zinc-900">
                        {mb ? mailboxLabel(mb) : "All mailboxes"}
                      </span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
                        {state ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", state.dot)} /> : null}
                        {mb ? `${mb.email} · ${state!.text}` : `${mailboxes.length} team members, one inbox`}
                      </span>
                    </span>
                    {scope === m.id ? <Check className="h-4 w-4 shrink-0 text-teal-700" /> : null}
                  </button>
                );
              })}
              <Link
                href="/mailbox/connections"
                className="mt-1 flex items-center gap-2 border-t border-zinc-100 px-2.5 pb-1 pt-2.5 text-xs font-medium text-teal-700 hover:underline"
              >
                <Settings2 className="h-3.5 w-3.5" /> Connect or manage mailboxes
              </Link>
            </div>
          ) : null}
        </div>

        <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-zinc-600 focus-within:bg-white focus-within:ring-1 focus-within:ring-teal-600">
          <Search className="h-4 w-4 shrink-0" />
          <span className="sr-only">Search all mail</span>
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={current ? `Search ${mailboxLabel(current)}'s mail` : "Search all mail, senders, PO numbers"}
            className="w-full bg-transparent outline-none"
          />
          {queryInput ? (
            <button type="button" onClick={() => setQueryInput("")} aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
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
            Counts are for this page. Deal threads use their stage agent; replies are written by Vibrium Copilot.
          </p>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {openItem ? (
            <InboxView
              item={openItem}
              outcome={outcomeOf(openItem)}
              dealHref={openItem.dealId ? `/deals/${encodeURIComponent(slugId(openItem.dealId))}` : null}
              dealCode={openItem.dealId ? deals.find((d) => d.mailboxSourceId === openItem.dealId)?.code || null : null}
              position={{ index: Math.max(openIndex, 0), total: Math.max(visible.length, 1) }}
              draft={drafts[openItem.id] || openItem.draft}
              draftStatus={draftStatus[openItem.id] || "idle"}
              sent={sent[readKey(openItem)] || null}
              sendLabel={`Send as ${mailboxLabel({ displayName: openItem.mailbox.mailboxName, email: openItem.mailbox.mailboxEmail })}`}
              sending={sending[openItem.id] || null}
              saveDraftLabel={savedDrafts[openItem.id] ? "Update draft" : "Save to Drafts"}
              onBack={() => setOpenId(null)}
              onStep={(dir) => {
                const next = visible[openIndex + dir];
                if (next) open(next);
              }}
              onChangeDraft={(body) =>
                setDrafts((d) => ({ ...d, [openItem.id]: { ...(d[openItem.id] || openItem.draft!), body } }))
              }
              onRewrite={() => void rewrite(openItem)}
              onSend={() => void reply(openItem, "send")}
              onSaveDraft={() => void reply(openItem, "draft")}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={loading || syncing}
                  className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
                  aria-label="Check for new mail"
                  title="Check for new mail"
                >
                  <RefreshCw className={cn("h-4 w-4", (loading || syncing) && "animate-spin")} />
                </button>
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
                {syncing ? <span className="text-xs text-zinc-500">Checking for new mail…</span> : null}
                <span className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
                  {pageLabel}
                  {nextCursor ? " of many" : ""}
                  <button
                    type="button"
                    onClick={() => goPage(-1)}
                    disabled={pageIndex === 0 || loading}
                    className="rounded-full p-1.5 hover:bg-zinc-100 disabled:opacity-30"
                    aria-label="Newer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goPage(1)}
                    disabled={!nextCursor || loading}
                    className="rounded-full p-1.5 hover:bg-zinc-100 disabled:opacity-30"
                    aria-label="Older"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading && !items.length ? (
                  <div className="p-4">
                    <ListSkeleton rows={8} />
                  </div>
                ) : error ? (
                  <p className="p-6 text-sm text-red-700">{error}</p>
                ) : visible.length === 0 ? (
                  <p className="p-8 text-center text-sm text-zinc-500">
                    {query
                      ? `No mail matches “${query}”.`
                      : folder !== "all"
                        ? "Nothing in this folder on this page."
                        : current && !current.lastSyncAt
                          ? `Importing ${current.email}… mail appears here as it syncs.`
                          : "No mail yet."}
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {visible.map((item) => {
                      const unreadRow = isUnread(item);
                      const outcome = outcomeOf(item);
                      const owner = byId.get(item.mailbox.connectionId);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => open(item)}
                            className={cn(
                              "flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50 hover:shadow-[inset_3px_0_0_#0f766e]",
                              !unreadRow && "bg-zinc-50/40",
                              outcome === "fyi" && "opacity-70",
                            )}
                          >
                            <span
                              className={cn(
                                "w-36 shrink-0 truncate text-sm lg:w-44",
                                unreadRow ? "font-semibold text-zinc-900" : "text-zinc-700",
                              )}
                            >
                              {displayName(item.latest.fromName, item.latest.from)}
                              {item.thread.length > 1 ? (
                                <span className="ml-1 text-xs font-normal text-zinc-400">{item.thread.length}</span>
                              ) : null}
                            </span>
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <OutcomeChip outcome={outcome} />
                              {scope === ALL && owner ? (
                                <span
                                  className="hidden shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-800 ring-1 ring-inset ring-teal-100 sm:inline"
                                  title={`In ${owner.email}`}
                                >
                                  {mailboxLabel(owner)}
                                </span>
                              ) : null}
                              <span
                                className={cn("truncate text-sm", unreadRow ? "font-semibold text-zinc-900" : "text-zinc-800")}
                              >
                                {item.subject}
                              </span>
                              <span className="hidden truncate text-sm text-zinc-500 lg:inline">
                                – {snippet(item.latest.body, 140)}
                              </span>
                            </span>
                            <time
                              className={cn("shrink-0 text-xs", unreadRow ? "font-semibold text-zinc-900" : "text-zinc-500")}
                            >
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
