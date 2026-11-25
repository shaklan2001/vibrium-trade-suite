"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NotebookPen, Plus, RotateCcw, Wallet } from "lucide-react";
import { CHANNEL_LABEL, type DealUpdateRecord } from "@/lib/trade/dealUpdate";
import { emitDealUpdatesChanged, onDealUpdatesChanged, openCopilot, storedAuthor } from "@/lib/trade/dealUpdateEvents";
import { cn } from "@/lib/utils";

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Command Center feed of what the team told Copilot from WhatsApp, calls and meetings,
 * so everyone sees it — with a button to log a new one.
 */
export function OffMailUpdates({ limit = 6 }: { limit?: number }) {
  const [updates, setUpdates] = useState<DealUpdateRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/copilot/updates?limit=${limit}`, { cache: "no-store" });
      const j = (await r.json()) as { updates?: DealUpdateRecord[] };
      setUpdates(j.updates || []);
      setFailed(false);
    } catch {
      setFailed(true);
      setUpdates((u) => u || []);
    }
    setNow(Date.now());
  }, [limit]);

  useEffect(() => {
    void load();
    return onDealUpdatesChanged(() => void load());
  }, [load]);

  async function undo(u: DealUpdateRecord) {
    if (armed !== u.id) {
      setArmed(u.id);
      return;
    }
    setBusy(u.id);
    try {
      const r = await fetch("/api/copilot/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", id: u.id, by: storedAuthor() || "team" }),
      });
      const j = (await r.json()) as { update?: DealUpdateRecord };
      if (r.ok && j.update) emitDealUpdatesChanged(j.update);
    } finally {
      setBusy(null);
      setArmed(null);
    }
  }

  return (
    <section className="cc-panel ou-panel" aria-labelledby="cc-offmail">
      <header className="cc-panel-head">
        <div>
          <h2 id="cc-offmail">Off-mail updates</h2>
          <p className="cc-panel-sub">Payments and news from WhatsApp, calls, meetings and bank advices, logged through Copilot.</p>
        </div>
        <button type="button" className="ou-log" onClick={() => openCopilot({ prefill: "" })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Log an update
        </button>
      </header>

      {updates === null ? (
        <p className="ou-empty">Loading updates…</p>
      ) : !updates.length ? (
        <p className="ou-empty">
          {failed
            ? "Couldn't load updates right now."
            : "Nothing logged yet. When a buyer confirms a payment on WhatsApp or a factory calls with news, tell Copilot — e.g. “Received $5K from the buyer for PO 15269 on WhatsApp”. It updates the deal after you confirm."}
        </p>
      ) : (
        <ul className="ou-list">
          {updates.map((u) => {
            const void_ = Boolean(u.voidedAt);
            return (
              <li key={u.id} className={cn("ou-row", void_ && "ou-void")}>
                <span className={cn("ou-icon", u.type === "payment" && "ou-icon-pay", void_ && "ou-icon-void")} aria-hidden>
                  {u.type === "payment" ? <Wallet className="h-4 w-4" /> : <NotebookPen className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="ou-text">{u.summary}</p>
                  <div className="ou-meta">
                    <Link href={u.href} className="ou-deal" title={u.dealTitle}>
                      {u.dealCode}
                    </Link>
                    {u.channel !== "other" ? (
                      <span className={cn("ou-chip", u.channel === "whatsapp" && "ou-chip-wa", u.channel === "bank" && "ou-chip-bank")}>{CHANNEL_LABEL[u.channel]}</span>
                    ) : null}
                    <span>by {u.author}</span>
                    {void_ ? <span className="ou-chip ou-chip-void">Undone{u.voidedBy ? ` by ${u.voidedBy}` : ""}</span> : null}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="ou-time">{ago(u.createdAt, now)}</span>
                  {!void_ ? (
                    <button
                      type="button"
                      className="du-text-btn"
                      onClick={() => void undo(u)}
                      onBlur={() => setArmed((a) => (a === u.id ? null : a))}
                      disabled={busy === u.id}
                      aria-label={armed === u.id ? `Confirm undo of ${u.summary}` : `Undo ${u.summary}`}
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      {busy === u.id ? "Undoing…" : armed === u.id ? "Confirm undo" : "Undo"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
