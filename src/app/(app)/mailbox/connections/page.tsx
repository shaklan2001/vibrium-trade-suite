"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Button, Card, CardHeader, Input, Label } from "@/components/ui/primitives";
import { ListSkeleton, LoadingBlock } from "@/components/ui/loading-block";
import { slugId } from "@/lib/trade/processedDealMapper";
import { hydrateMailboxBook } from "@/lib/trade/mailboxHydrate";
import { useTradeStore } from "@/lib/trade/store";
import { STAGE_LABELS, type Deal } from "@/types/trade";
import { describeSync, syncMailNow } from "@/lib/mail/client";
import type {
  MailConnectionPublic,
  MailMessageSummary,
  MailProviderId,
} from "@/lib/mail/types";

type Setup = {
  database: boolean;
  encryption: boolean;
  vibrium: boolean;
  providers: Record<MailProviderId, boolean>;
};

type ConnectionsResponse = {
  setup: Setup;
  connections: MailConnectionPublic[];
  jobs: Record<string, number>;
  error?: string;
};

const PROVIDER_NAMES: Record<MailProviderId, string> = {
  google: "Gmail",
  microsoft: "Outlook",
  imap: "IMAP",
};

const IMAP_PRESETS: Record<string, { host: string; port: number }> = {
  custom: { host: "", port: 993 },
  gmail: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  zoho: { host: "imap.zoho.in", port: 993 },
  godaddy: { host: "imap.secureserver.net", port: 993 },
  yahoo: { host: "imap.mail.yahoo.com", port: 993 },
};

const RECENT_PREVIEW = 8;

function ago(iso: string | null | undefined, now: number) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** One plain-language status per email instead of pipeline internals. */
function emailStatus(m: MailMessageSummary) {
  if (m.status === "noise") return { label: "Filtered", tone: "neutral" as const };
  if (m.status === "error") return { label: "Couldn't read", tone: "danger" as const };
  switch (m.job_status) {
    case "done":
      return { label: "Added to deal", tone: "success" as const };
    case "skipped":
      return { label: "Not a deal", tone: "neutral" as const };
    case "failed":
      return { label: "Will retry", tone: "warning" as const };
    default:
      return { label: "Reading…", tone: "info" as const };
  }
}

function connectionHealth(c: MailConnectionPublic) {
  if (c.status === "reauth_required")
    return { dot: "bg-red-500", text: "Access expired — reconnect to keep syncing" };
  if (c.status === "paused") return { dot: "bg-zinc-400", text: "Paused" };
  if (c.status === "error")
    return { dot: "bg-amber-500", text: "Last sync had a problem — it will retry" };
  return { dot: "bg-emerald-500", text: "Syncing automatically" };
}

function partyNames(deal: Deal) {
  const pick = (role: string) =>
    deal.parties.filter((p) => p.role === role).map((p) => p.company || p.name)[0];
  return [pick("buyer"), pick("factory") || pick("forwarder")].filter(Boolean).join(" · ");
}

function ImapForm({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState("custom");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(993);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/mail/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, user: email, host, port, secure: true, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(`Connected ${email} — importing your recent mail`);
      setPassword("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
      <div>
        <Label>Mail provider</Label>
        <select
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            const p = IMAP_PRESETS[e.target.value];
            if (p?.host) {
              setHost(p.host);
              setPort(p.port);
            }
          }}
        >
          {Object.keys(IMAP_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k === "custom" ? "Other server" : k[0]!.toUpperCase() + k.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <div>
          <Label>Server</Label>
          <Input required value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" />
        </div>
        <div>
          <Label>Port</Label>
          <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 993)} />
        </div>
      </div>
      <div>
        <Label>Email address</Label>
        <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </div>
      <div>
        <Label>App password</Label>
        <Input
          required
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

export default function EmailPage() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [showImap, setShowImap] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  const [now, setNow] = useState(Date.now());
  const bookDeals = useTradeStore((s) => s.deals);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        fetch("/api/mail/connections", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/mail/messages?limit=200", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { messages: [] }))
          .catch(() => ({ messages: [] })),
      ]);
      setData(c as ConnectionsResponse);
      setMessages((m as { messages?: MailMessageSummary[] }).messages || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // OAuth callback lands here with ?connected= or ?error=
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const connected = sp.get("connected");
    const error = sp.get("error");
    if (connected) toast.success(`Connected ${connected} — importing your recent mail`);
    if (error) toast.error(error);
    if (connected || error) window.history.replaceState(null, "", "/mailbox/connections");
  }, []);

  const inFlight = (data?.jobs.running || 0) + (data?.jobs.pending || 0) + (data?.jobs.starting || 0);

  useEffect(() => {
    void load();
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, [load]);

  // Refresh faster while agents are still reading conversations.
  useEffect(() => {
    const t = window.setInterval(
      async () => {
        if (inFlight > 0) {
          await fetch("/api/mail/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobs_only: true }),
          }).catch(() => undefined);
          void hydrateMailboxBook();
        }
        void load();
      },
      inFlight > 0 ? 12_000 : 30_000,
    );
    return () => window.clearInterval(t);
  }, [inFlight, load]);

  async function syncNow(connectionId?: string) {
    setSyncing(connectionId || "all");
    const toastId = toast.loading("Checking for new mail…");
    try {
      const r = await syncMailNow({
        connectionId,
        onProgress: (p) => {
          toast.loading(
            `Checking… ${p.ingested} new email${p.ingested === 1 ? "" : "s"}${p.remaining ? `, ${p.remaining} to go` : ""}`,
            { id: toastId },
          );
          void load();
        },
      });
      if (r.errors.length) toast.error(r.errors[0], { id: toastId });
      else if (r.locked && r.rounds === 1) toast.message("Already syncing — results appear shortly", { id: toastId });
      else toast.success(r.ingested ? describeSync(r) : "You're up to date", { id: toastId });
      await hydrateMailboxBook();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed", { id: toastId });
    } finally {
      setSyncing(null);
      void load();
    }
  }

  async function setPaused(c: MailConnectionPublic, paused: boolean) {
    const res = await fetch(`/api/mail/connections/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: paused ? "paused" : "active" }),
    });
    if (!res.ok) toast.error("Couldn't update");
    void load();
  }

  async function disconnect(c: MailConnectionPublic) {
    if (!window.confirm(`Disconnect ${c.email}? Deals already found stay in the book.`)) return;
    const res = await fetch(`/api/mail/connections/${c.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("Disconnect failed");
    else toast.success(`Disconnected ${c.email}`);
    void load();
  }

  function connectGoogle() {
    window.location.href = "/api/mail/oauth/google/start";
  }

  const setup = data?.setup;
  const ready = Boolean(setup?.database && setup?.encryption);
  const connections = useMemo(() => data?.connections || [], [data]);

  // Deals the agents built from this mail, newest first, enriched from the book.
  const emailDeals = useMemo(() => {
    const byKey = new Map<string, { subject: string; at: string | null }>();
    for (const m of messages) {
      if (m.status !== "ingested" || m.job_status !== "done" || !m.deal_key) continue;
      if (!byKey.has(m.deal_key)) byKey.set(m.deal_key, { subject: m.subject || "", at: m.sent_at });
    }
    return [...byKey.entries()].map(([key, meta]) => ({
      key,
      href: `/deals/${encodeURIComponent(slugId(key))}`,
      deal: bookDeals.find((d) => d.mailboxSourceId === key) || null,
      ...meta,
    }));
  }, [messages, bookDeals]);

  const dealsPerConnection = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const m of messages) {
      if (m.job_status !== "done" || !m.deal_key) continue;
      if (!out.has(m.connection_id)) out.set(m.connection_id, new Set());
      out.get(m.connection_id)!.add(m.deal_key);
    }
    return out;
  }, [messages]);

  const reading = useMemo(
    () =>
      new Set(
        messages
          .filter((m) => m.status === "ingested" && !["done", "skipped", "failed"].includes(m.job_status || ""))
          .map((m) => m.deal_key),
      ).size,
    [messages],
  );

  const recent = useMemo(() => {
    const list = showFiltered ? messages : messages.filter((m) => m.status !== "noise");
    return showAllRecent ? list.slice(0, 60) : list.slice(0, RECENT_PREVIEW);
  }, [messages, showAllRecent, showFiltered]);

  const otherProviders = (
    <div className="mt-3">
      <button
        type="button"
        className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
        onClick={() => setShowOthers((v) => !v)}
      >
        {showOthers ? "Hide other options" : "Use Outlook or another email provider"}
      </button>
      {showOthers ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!setup?.providers.microsoft}
            title={setup?.providers.microsoft ? undefined : "Outlook sign-in isn't set up yet"}
            onClick={() => (window.location.href = "/api/mail/oauth/microsoft/start")}
          >
            <Inbox className="h-4 w-4" /> Outlook / Microsoft 365
          </Button>
          <Button variant="secondary" onClick={() => setShowImap((v) => !v)}>
            <Server className="h-4 w-4" /> Other (IMAP)
          </Button>
        </div>
      ) : null}
      {showOthers && showImap ? (
        <ImapForm
          onDone={() => {
            setShowImap(false);
            setShowOthers(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Your email"
        description="New emails from buyers, factories and forwarders become deals automatically. Read-only — nothing is ever sent or changed in your inbox."
        actions={
          connections.length ? (
            <Button onClick={() => syncNow()} disabled={syncing !== null}>
              <RefreshCw className={`h-4 w-4 ${syncing === "all" ? "animate-spin" : ""}`} />
              {syncing === "all" ? "Checking…" : "Check for new mail"}
            </Button>
          ) : null
        }
      />

      {loading ? (
        <>
          <LoadingBlock label="Loading…" className="mb-4" />
          <ListSkeleton rows={3} />
        </>
      ) : (
        <>
          {!ready || data?.error ? (
            <Card className="mb-6 flex items-start gap-3 border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Email sync isn&apos;t available right now. Please ask your admin to finish the
                server setup.
              </div>
            </Card>
          ) : null}

          {connections.length === 0 ? (
            <Card className="mb-6 px-6 py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
                <Mail className="h-6 w-6 text-teal-700" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-zinc-900">Connect your email</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
                We&apos;ll import the last 30 days and then keep checking for new mail. Orders,
                quotes and shipments you discuss by email show up as deals — no uploading.
              </p>
              <Button
                className="mt-5"
                disabled={!ready || !setup?.providers.google}
                onClick={connectGoogle}
              >
                <Mail className="h-4 w-4" /> Connect Gmail
              </Button>
              <p className="mx-auto mt-3 max-w-md text-xs text-zinc-400">
                Read-only access. We never send, delete or change your email.{" "}
                <Link href="/privacy" className="underline hover:text-zinc-600">
                  Privacy policy
                </Link>
              </p>
              <div className="flex justify-center">{otherProviders}</div>
            </Card>
          ) : (
            <Card className="mb-6">
              <ul className="divide-y divide-zinc-100">
                {connections.map((c) => {
                  const health = connectionHealth(c);
                  const found = dealsPerConnection.get(c.id)?.size || 0;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-semibold uppercase text-teal-800">
                          {c.email[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900">{c.email}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500" title={c.last_error || undefined}>
                            <span className={`h-2 w-2 rounded-full ${health.dot}`} />
                            {health.text} · {PROVIDER_NAMES[c.provider]} · checked {ago(c.last_sync_at, now)}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {c.stats?.messages || 0} emails read · {found} deal{found === 1 ? "" : "s"} found
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {c.status === "reauth_required" && c.provider === "google" ? (
                          <Button onClick={connectGoogle}>Reconnect</Button>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={syncing !== null || c.status === "paused"}
                            onClick={() => syncNow(c.id)}
                          >
                            <RefreshCw className={`h-4 w-4 ${syncing === c.id ? "animate-spin" : ""}`} />
                            Sync
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          title={c.status === "paused" ? "Resume syncing" : "Pause syncing"}
                          onClick={() => setPaused(c, c.status !== "paused")}
                        >
                          {c.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" title="Disconnect" onClick={() => disconnect(c)}>
                          <Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-600" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-zinc-100 px-4 py-3">
                <button
                  type="button"
                  disabled={!ready}
                  onClick={connectGoogle}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:underline disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Connect another Gmail
                </button>
                {otherProviders}
              </div>
            </Card>
          )}

          {connections.length ? (
            <>
              <Card className="mb-6">
                <CardHeader
                  title="Deals found in your email"
                  description={
                    reading
                      ? `Reading ${reading} conversation${reading === 1 ? "" : "s"}… new deals appear here.`
                      : "Opened from your conversations with buyers, factories and forwarders."
                  }
                  action={
                    <Link href="/deals" className="text-xs font-medium text-teal-700 hover:underline">
                      Deal Board →
                    </Link>
                  }
                />
                {emailDeals.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-zinc-500">
                    No deals yet. When a buyer, factory or forwarder emails you about an order,
                    quote or shipment, it will show up here.
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {emailDeals.map(({ key, href, deal, subject, at }) => (
                      <li key={key}>
                        <Link
                          href={href}
                          className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-zinc-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900">
                              {deal?.title || subject || "Untitled deal"}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-zinc-500">
                              {[deal?.code, deal ? partyNames(deal) : "", ago(at, now)]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {deal ? <Badge tone="info">{STAGE_LABELS[deal.stage]}</Badge> : null}
                            <ArrowRight className="h-4 w-4 text-zinc-300" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Recent emails"
                  action={
                    <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <input
                        type="checkbox"
                        checked={showFiltered}
                        onChange={(e) => setShowFiltered(e.target.checked)}
                      />
                      Show newsletters &amp; notifications
                    </label>
                  }
                />
                {recent.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-zinc-500">No emails yet.</p>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {recent.map((m) => {
                      const s = emailStatus(m);
                      const row = (
                        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-zinc-900">{m.subject || "(no subject)"}</div>
                            <div className="truncate text-xs text-zinc-500">
                              {m.from_name || m.from_email || "Unknown sender"} · {ago(m.sent_at, now)}
                            </div>
                          </div>
                          <span className="shrink-0 whitespace-nowrap">
                            <Badge tone={s.tone}>{s.label}</Badge>
                          </span>
                        </div>
                      );
                      return (
                        <li key={`${m.connection_id}:${m.provider_message_id}`}>
                          {m.job_status === "done" && m.deal_key ? (
                            <Link
                              href={`/deals/${encodeURIComponent(slugId(m.deal_key))}`}
                              className="block transition hover:bg-zinc-50"
                            >
                              {row}
                            </Link>
                          ) : (
                            row
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {messages.length > RECENT_PREVIEW ? (
                  <div className="border-t border-zinc-100 px-4 py-2.5">
                    <button
                      type="button"
                      className="text-xs font-medium text-teal-700 hover:underline"
                      onClick={() => setShowAllRecent((v) => !v)}
                    >
                      {showAllRecent ? "Show less" : "Show more"}
                    </button>
                  </div>
                ) : null}
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
