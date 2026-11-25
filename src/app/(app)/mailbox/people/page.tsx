"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Crown,
  Mail,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { ListSkeleton } from "@/components/ui/loading-block";
import { storedAuthor } from "@/lib/trade/dealUpdateEvents";
import type {
  ActiveSetting,
  PersonaKind,
  PersonStats,
} from "@/lib/trade/people/people";
import { cn } from "@/lib/utils";

type Summary = {
  people: PersonStats[];
  historyBuiltAt: string | null;
  stale?: boolean;
  messagesRead?: number;
  dealsRead?: number;
};

type PersonDeal = {
  dealKey: string;
  code: string;
  title: string;
  href: string;
  stage: string;
  role: "owner" | "involved";
  score: number;
  sent: number;
  to: number;
  lastAt: string;
  lastAction: "sent" | "to";
  latestSender: boolean;
  pinned: boolean;
  owner: { id: string; name: string; pinned: boolean } | null;
};

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "never";
const daysAgo = (iso: string | null | undefined) =>
  iso
    ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000))
    : null;
const ACTION: Record<PersonDeal["lastAction"], string> = {
  sent: "replied",
  to: "received",
};
const ROLE_TABS = [
  { key: "owner", label: "Owner" },
  { key: "involved", label: "Works on" },
] as const;

/**
 * Team & deals: who on the team works which deal, read from the mail (who replied — the latest reply
 * counts most — and who it was sent to; cc is ignored; inactive people own nothing). People can be edited
 * (name, extra addresses, shared mailbox, active) and a deal's owner pinned by hand. Copilot uses the
 * same index for "Radha's POs".
 */
export default function PeoplePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/people", { cache: "no-store" });
      const j = (await r.json()) as Summary;
      setSummary({ ...j, people: j.people || [] });
      setSelected(
        (s) => s ?? j.people?.find((p) => p.kind === "person")?.id ?? null,
      );
    } catch {
      setSummary({ people: [], historyBuiltAt: null });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rebuild() {
    setRebuilding(true);
    try {
      const r = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild" }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        messages?: number;
        deals?: number;
        fetched?: number;
        error?: string;
      };
      if (!r.ok || !j.ok)
        toast.error(j.error || "Could not read the mail again");
      else
        toast.success(
          `Read ${j.fetched?.toLocaleString()} new or changed deals · ${j.messages?.toLocaleString()} messages on ${j.deals?.toLocaleString()} deals in all`,
        );
      await load();
    } finally {
      setRebuilding(false);
    }
  }

  const people = useMemo(() => {
    const all = summary?.people || [];
    const t = q.trim().toLowerCase();
    return t
      ? all.filter((p) =>
          `${p.name} ${p.emails.join(" ")} ${p.title}`
            .toLowerCase()
            .includes(t),
        )
      : all;
  }, [summary, q]);
  const current = summary?.people.find((p) => p.id === selected) || null;

  return (
    <div>
      <PageHeader
        title="Team & deals"
        description="Who works which deal, read from the mail. Copilot uses this for questions like “Radha’s POs”."
        actions={
          <Button
            variant="secondary"
            onClick={() => void rebuild()}
            disabled={rebuilding}
          >
            <RefreshCw
              className={cn("mr-1.5 h-4 w-4", rebuilding && "animate-spin")}
              aria-hidden
            />
            {rebuilding ? "Reading mail…" : "Read mail again"}
          </Button>
        }
      />

      {summary === null ? null : (
        <p className="pp-how-meta mb-3">
          {summary.historyBuiltAt
            ? `Mail read ${day(summary.historyBuiltAt)} · ${summary.messagesRead?.toLocaleString() ?? "—"} messages on ${summary.dealsRead?.toLocaleString() ?? "—"} deals · newest mail added live`
            : "The mail has not been read yet — press Read mail again."}
        </p>
      )}

      {summary === null ? (
        <ListSkeleton rows={6} />
      ) : !summary.people.length ? (
        <Card className="p-6 text-sm text-zinc-500">
          No team people yet. Read the mail to build the list.
        </Card>
      ) : (
        <div className="pp-grid">
          <Card className="pp-people">
            <label className="pp-search">
              <Search className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a person or address"
                aria-label="Find a person"
              />
            </label>
            <ul>
              {people.map((p) => {
                const ago = daysAgo(p.lastSentAt);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={cn(
                        "pp-person",
                        p.id === selected && "pp-person-on",
                      )}
                      onClick={() => setSelected(p.id)}
                    >
                      <span
                        className={cn(
                          "pp-avatar",
                          p.kind === "shared" && "pp-avatar-shared",
                          !p.isActive && "pp-avatar-off",
                        )}
                        aria-hidden
                      >
                        {p.kind === "shared" ? (
                          <Mail className="h-4 w-4" />
                        ) : (
                          p.name.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="pp-name">{p.name}</span>
                        <span className="pp-sub">
                          {p.kind === "shared"
                            ? "Shared mailbox"
                            : p.isActive
                              ? `Active · sent ${ago === 0 ? "today" : `${ago}d ago`}`
                              : `Inactive${ago != null ? ` · last sent ${ago}d ago` : ""}`}
                        </span>
                      </span>
                      <span className="pp-counts">
                        <b>{p.owner}</b>
                        <span>own</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          {current ? (
            <PersonPanel
              // A save (here or elsewhere) changes the key, so the form shows what is stored.
              key={`${current.id}|${current.name}|${current.title}|${current.kind}|${current.active}|${current.note}|${current.emails.join(",")}`}
              person={current}
              people={summary.people}
              onSaved={load}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PersonPanel({
  person,
  people,
  onSaved,
}: {
  person: PersonStats;
  people: PersonStats[];
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(person.name);
  const [title, setTitle] = useState(person.title);
  const [emails, setEmails] = useState(person.emails);
  const [newEmail, setNewEmail] = useState("");
  const [kind, setKind] = useState<PersonaKind>(person.kind);
  const [active, setActive] = useState<ActiveSetting>(person.active);
  const [note, setNote] = useState(person.note);
  const [saving, setSaving] = useState(false);
  const [deals, setDeals] = useState<PersonDeal[] | null>(null);
  const [tab, setTab] = useState<PersonDeal["role"]>("owner");
  const [busy, setBusy] = useState<string | null>(null);

  const loadDeals = useCallback(async () => {
    const r = await fetch(
      `/api/people?person=${encodeURIComponent(person.id)}`,
      { cache: "no-store" },
    );
    const j = (await r.json()) as { deals?: PersonDeal[] };
    setDeals(j.deals || []);
  }, [person.id]);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  const dirty =
    name !== person.name ||
    title !== person.title ||
    kind !== person.kind ||
    active !== person.active ||
    note !== person.note ||
    emails.join() !== person.emails.join();
  const elsewhere = (e: string) =>
    people.find((p) => p.id !== person.id && p.emails.includes(e));

  function addEmail() {
    const e = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) {
      toast.error("Enter a full email address");
      return;
    }
    if (!emails.includes(e)) setEmails([...emails, e]);
    setNewEmail("");
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_persona",
          id: person.id,
          name,
          title,
          emails,
          kind,
          active,
          note,
          by: storedAuthor() || "team",
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        toast.error(j.error || "Could not save");
        return;
      }
      toast.success(`${name} saved — Copilot and the deal owners use it now`);
      await onSaved();
      await loadDeals();
    } finally {
      setSaving(false);
    }
  }

  async function pin(d: PersonDeal, personId: string | null) {
    setBusy(d.dealKey);
    try {
      const r = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pin_owner",
          dealKey: d.dealKey,
          personId,
          by: storedAuthor() || "team",
        }),
      });
      if (!r.ok) toast.error("Could not change the owner");
      else
        toast.success(
          personId
            ? `${person.name} is now the owner of ${d.code}`
            : `${d.code}: owner from the mail again`,
        );
      await Promise.all([loadDeals(), onSaved()]);
    } finally {
      setBusy(null);
    }
  }

  const shown = (deals || []).filter((d) => d.role === tab);
  const top = Math.max(1, ...(deals || []).map((d) => d.score));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="pp-title">{person.name}</h2>
            <p className="pp-sub">
              {person.kind === "shared"
                ? "Shared mailbox"
                : person.isActive
                  ? "Active"
                  : "Inactive"}{" "}
              · last sent {day(person.lastSentAt)} · on{" "}
              {(person.owner + person.involved).toLocaleString()} deals
            </p>
          </div>
          <div className="pp-stats">
            <span>
              <b>{person.owner}</b> owner
            </span>
            <span>
              <b>{person.involved}</b> works on
            </span>
          </div>
        </div>

        <div className="pp-form">
          <label className="du-field">
            <span className="du-label">Name</span>
            <input
              className="du-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <label className="du-field">
            <span className="du-label">Role / title (optional)</span>
            <input
              className="du-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Merchandiser, Waldo's account"
              maxLength={80}
            />
          </label>
          <div className="du-field pp-span">
            <span className="du-label">
              Email addresses (mail from any of them counts for{" "}
              {name || "this person"})
            </span>
            <div className="pp-emails">
              {emails.map((e) => (
                <span key={e} className="pp-email">
                  {e}
                  {elsewhere(e) ? (
                    <em> (moves from {elsewhere(e)!.name})</em>
                  ) : null}
                  {emails.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove ${e}`}
                      onClick={() => setEmails(emails.filter((x) => x !== e))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              ))}
              <span className="pp-email-add">
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.preventDefault(), addEmail())
                  }
                  placeholder="add another address"
                  aria-label="Add an email address"
                />
                <button
                  type="button"
                  onClick={addEmail}
                  aria-label="Add address"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </div>
          <div className="du-field">
            <span className="du-label">This is</span>
            <div
              className="du-seg"
              role="radiogroup"
              aria-label="Person or shared mailbox"
            >
              {(["person", "shared"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={cn("du-seg-btn", kind === k && "du-seg-on")}
                  onClick={() => setKind(k)}
                >
                  {k === "person" ? "A person" : "Shared mailbox"}
                </button>
              ))}
            </div>
          </div>
          <div className="du-field">
            <span className="du-label">Status</span>
            <div className="du-seg" role="radiogroup" aria-label="Active">
              {(["auto", "active", "inactive"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={active === a}
                  className={cn("du-seg-btn", active === a && "du-seg-on")}
                  onClick={() => setActive(a)}
                >
                  {a === "auto"
                    ? "From mail"
                    : a === "active"
                      ? "Active"
                      : "Inactive (left)"}
                </button>
              ))}
            </div>
          </div>
          <label className="du-field pp-span">
            <span className="du-label">Note (optional)</span>
            <input
              className="du-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. handles Waldo's and Dollarama"
              maxLength={500}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty ? (
            <span className="text-xs text-zinc-500">Unsaved changes</span>
          ) : null}
          <Button
            onClick={() => void save()}
            disabled={!dirty || saving || !name.trim() || !emails.length}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <div className="br-tabs px-4" role="tablist" aria-label="Deals">
          {ROLE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={cn("br-tab", tab === t.key && "br-tab-on")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="br-count">
                {(deals || []).filter((d) => d.role === t.key).length}
              </span>
            </button>
          ))}
        </div>
        {deals === null ? (
          <div className="p-4">
            <ListSkeleton rows={5} />
          </div>
        ) : !shown.length ? (
          <p className="br-empty px-4 pb-4">Nothing here.</p>
        ) : (
          <ul className="pp-deals">
            {shown.slice(0, 200).map((d) => (
              <li key={d.dealKey} className="pp-deal">
                <div className="min-w-0">
                  <p className="pp-deal-head">
                    <Link href={d.href} className="br-deal">
                      {d.code}
                    </Link>
                    {d.role === "owner" ? (
                      <Badge tone={d.pinned ? "info" : "success"}>
                        {d.pinned ? (
                          <Pin className="mr-1 inline h-3 w-3" aria-hidden />
                        ) : (
                          <Crown className="mr-1 inline h-3 w-3" aria-hidden />
                        )}
                        {d.pinned ? "Owner (pinned)" : "Owner"}
                      </Badge>
                    ) : d.owner ? (
                      <span className="pp-other">owner: {d.owner.name}</span>
                    ) : null}
                  </p>
                  <p className="pp-deal-title">{d.title}</p>
                  <p className="pp-deal-meta">
                    {d.latestSender ? <b>Sent the latest reply · </b> : null}
                    last {ACTION[d.lastAction]} {day(d.lastAt)} · replied{" "}
                    {d.sent}, received {d.to}
                  </p>
                </div>
                <div className="pp-deal-right">
                  <span className="pp-bar" title={`Weight ${d.score}`}>
                    <span
                      style={{
                        width: `${Math.max(4, Math.round((d.score / top) * 100))}%`,
                      }}
                    />
                  </span>
                  {d.role === "owner" && d.pinned ? (
                    <button
                      type="button"
                      className="du-text-btn"
                      disabled={busy === d.dealKey}
                      onClick={() => void pin(d, null)}
                    >
                      <PinOff className="h-3 w-3" aria-hidden /> Unpin
                    </button>
                  ) : d.role !== "owner" && person.kind === "person" ? (
                    <button
                      type="button"
                      className="du-text-btn"
                      disabled={busy === d.dealKey}
                      onClick={() => void pin(d, person.id)}
                    >
                      <Pin className="h-3 w-3" aria-hidden /> Make owner
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {shown.length > 200 ? (
          <p className="br-empty px-4 pb-4">
            Showing the first 200 of {shown.length}.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
