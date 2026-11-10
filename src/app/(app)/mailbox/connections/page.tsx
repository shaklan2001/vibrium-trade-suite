"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Inbox, KeyRound, Pause, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { ImapConnectForm } from "@/components/mail/imap-connect-form";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { ListSkeleton } from "@/components/ui/loading-block";
import { describeSync, syncMailNow } from "@/lib/mail/client";
import type { MailConnectionPublic } from "@/lib/mail/types";

/**
 * Email connections: the team's mailboxes. Anyone can connect their own
 * mailbox here (email + password over IMAP/SMTP); every connected mailbox
 * feeds the shared Inbox and the Mailbox book.
 */

type ConnectionsResponse = {
  connections?: MailConnectionPublic[];
  jobs?: Record<string, number>;
  error?: string;
};

function ago(iso: string | null | undefined, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function health(c: MailConnectionPublic): { tone: "success" | "warning" | "danger" | "info" | "neutral"; text: string } {
  if (c.status === "reauth_required") return { tone: "danger", text: "Password needed" };
  if (c.status === "paused") return { tone: "neutral", text: "Paused" };
  if (c.status === "error") return { tone: "warning", text: "Sync error" };
  if (!c.last_sync_at) return { tone: "info", text: "Importing" };
  return { tone: "success", text: "Connected" };
}

export default function EmailConnectionsPage() {
  const [connections, setConnections] = useState<MailConnectionPublic[]>([]);
  const [jobs, setJobs] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reconnect, setReconnect] = useState<MailConnectionPublic | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mail/connections", { cache: "no-store" });
      const body = (await res.json()) as ConnectionsResponse;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setConnections(body.connections || []);
      setJobs(body.jobs || {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load connections");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const sorted = useMemo(
    () => [...connections].sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email)),
    [connections],
  );
  const totals = useMemo(
    () => ({
      mails: connections.reduce((n, c) => n + (c.stats?.messages || 0), 0),
      deals: connections.reduce((n, c) => n + (c.stats?.deals || 0), 0),
      attention: connections.filter((c) => c.status === "reauth_required" || c.status === "error").length,
    }),
    [connections],
  );
  const agentsWorking = (jobs.running || 0) + (jobs.starting || 0) + (jobs.pending || 0);

  async function syncNow(id?: string) {
    setSyncing(id || "all");
    try {
      const result = await syncMailNow({
        connectionId: id,
        onProgress: (p) => toast.loading(describeSync(p), { id: "mail-sync" }),
      });
      if (result.errors.length) toast.error(result.errors[0]!, { id: "mail-sync" });
      else toast.success(describeSync(result), { id: "mail-sync" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed", { id: "mail-sync" });
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
    if (!res.ok) toast.error("Could not update the mailbox");
    void load();
  }

  async function disconnect(c: MailConnectionPublic) {
    if (
      !window.confirm(
        `Disconnect ${c.email}? Its stored mail and password are removed from Vibrium. Deals already in the book stay. This can't be undone.`,
      )
    )
      return;
    const res = await fetch(`/api/mail/connections/${c.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("Disconnect failed");
    else toast.success(`Disconnected ${c.email}`);
    void load();
  }

  function connected() {
    setAdding(false);
    setReconnect(null);
    void load();
    void syncNow();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Email connections"
        description="Each team member connects their mailbox once. Every connected mailbox feeds the shared Inbox and the Mailbox book."
        actions={
          <div className="flex flex-wrap gap-2">
            {connections.length ? (
              <Button variant="secondary" onClick={() => void syncNow()} disabled={syncing !== null}>
                <RefreshCw className={`h-4 w-4 ${syncing === "all" ? "animate-spin" : ""}`} />
                {syncing === "all" ? "Checking…" : "Check all for new mail"}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setReconnect(null);
                setAdding(true);
              }}
            >
              <Plus className="h-4 w-4" /> Connect a mailbox
            </Button>
          </div>
        }
      />

      {adding || reconnect || (!loading && !connections.length) ? (
        <Card className="mb-6">
          <CardHeader
            title={reconnect ? `Update the password for ${reconnect.email}` : "Connect a mailbox"}
            description={
              reconnect
                ? "Enter the current mailbox password. Everything already imported stays."
                : "Just the email address and mailbox password — the company mail server is already set up."
            }
            action={
              connections.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setReconnect(null);
                  }}
                  className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null
            }
          />
          <div className="px-4 pb-5">
            <ImapConnectForm
              key={reconnect?.id || "new"}
              onConnected={connected}
              defaultEmail={reconnect?.email}
              defaultName={reconnect?.display_name || ""}
              submitLabel={reconnect ? "Update password" : "Connect mailbox"}
            />
          </div>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader
          title={`Team mailboxes (${connections.length})`}
          description={
            connections.length
              ? `${totals.mails.toLocaleString()} emails synced · ${totals.deals} deals found${
                  agentsWorking ? ` · agents reading ${agentsWorking} conversation${agentsWorking === 1 ? "" : "s"}` : ""
                }${totals.attention ? ` · ${totals.attention} need attention` : ""}`
              : "No mailbox connected yet."
          }
          action={
            <Link href="/mailbox/inbox" className="text-xs font-medium text-teal-700 hover:underline">
              Open shared inbox →
            </Link>
          }
        />
        {loading ? (
          <div className="p-4">
            <ListSkeleton rows={3} />
          </div>
        ) : error ? (
          <p className="px-4 pb-4 text-sm text-red-700">{error}</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sorted.map((c) => {
              const h = health(c);
              const imap = c.settings_json.imap;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-semibold uppercase text-teal-800">
                      {(c.display_name || c.email)[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-zinc-900">{c.display_name || c.email.split("@")[0]}</span>
                        <Badge tone={h.tone}>{h.text}</Badge>
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {c.email} · IMAP {imap ? `${imap.host}:${imap.port}` : ""} · checked {ago(c.last_sync_at, now)}
                      </div>
                      <div className="text-xs text-zinc-500" title={c.last_error || undefined}>
                        {(c.stats?.messages || 0).toLocaleString()} emails · {c.stats?.deals || 0} deals
                        {c.last_error ? <span className="text-amber-700"> · {c.last_error.slice(0, 90)}</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Link
                      href={`/mailbox/inbox?mailbox=${encodeURIComponent(c.id)}`}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    >
                      <Inbox className="h-3.5 w-3.5" /> Inbox
                    </Link>
                    {c.status === "reauth_required" ? (
                      <Button
                        onClick={() => {
                          setAdding(false);
                          setReconnect(c);
                        }}
                      >
                        <KeyRound className="h-4 w-4" /> Update password
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={syncing !== null || c.status === "paused"}
                        onClick={() => void syncNow(c.id)}
                      >
                        <RefreshCw className={`h-4 w-4 ${syncing === c.id ? "animate-spin" : ""}`} /> Sync
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => void setPaused(c, c.status !== "paused")}
                      className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100"
                      aria-label={c.status === "paused" ? `Resume ${c.email}` : `Pause ${c.email}`}
                      title={c.status === "paused" ? "Resume syncing" : "Pause syncing"}
                    >
                      {c.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void disconnect(c)}
                      className="rounded-md p-2 text-zinc-500 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Disconnect ${c.email}`}
                      title="Disconnect"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs leading-relaxed text-zinc-500">
        New mail is pulled every few minutes while the suite is open and once a day otherwise. Mail from buyers,
        factories and forwarders is read by the stage agents and becomes deals in the{" "}
        <Link href="/mailbox" className="text-teal-700 hover:underline">
          Mailbox book
        </Link>
        . Passwords are stored encrypted and never shown again.
      </p>
    </div>
  );
}
