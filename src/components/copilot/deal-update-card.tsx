"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CircleAlert, NotebookPen, Pencil, RotateCcw, Search, Wallet, X } from "lucide-react";
import {
  CHANNEL_LABEL,
  describeUpdate,
  formatMoney,
  PAYMENT_KIND_LABEL,
  SIDE_LABEL,
  type DealUpdateChannel,
  type DealUpdateDealRef,
  type DealUpdatePayment,
  type DealUpdateProposal,
  type DealUpdateRecord,
  type DealUpdateType,
} from "@/lib/trade/dealUpdate";
import { emitDealUpdatesChanged, rememberAuthor, storedAuthor } from "@/lib/trade/dealUpdateEvents";
import { cn } from "@/lib/utils";

export type DealUpdateCardState =
  | { status: "draft" }
  | { status: "saved"; update: DealUpdateRecord }
  | { status: "cancelled" };

const CURRENCIES = ["USD", "INR", "EUR", "GBP", "AED", "CNY"];
const KIND_OPTIONS: { value: DealUpdatePayment["kind"]; label: string; hint: string }[] = [
  { value: "payment_received", label: "Received", hint: "Money is in our / the payee's account" },
  { value: "payment_sent", label: "Sent", hint: "Payer says it is sent, or we paid" },
  { value: "payment_request", label: "Requested", hint: "Someone asked to be paid" },
];
const CHANNELS: DealUpdateChannel[] = ["whatsapp", "phone", "meeting", "other"];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function postUpdates<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/copilot/updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: V; label: string; title?: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="du-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn("du-seg-btn", value === o.value && "du-seg-on")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Find another deal by PO, code or party name. */
function DealPicker({
  onPick,
  onClose,
}: {
  onPick: (d: DealUpdateDealRef) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DealUpdateDealRef[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      postUpdates<{ deals: DealUpdateDealRef[] }>({ action: "search", q: term })
        .then((j) => alive && setHits(j.deals || []))
        .catch(() => alive && setHits([]))
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="du-picker">
      <div className="du-picker-input">
        <Search className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="PO number, deal code, buyer or factory"
          aria-label="Find a deal"
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <button type="button" onClick={onClose} aria-label="Close deal search" className="du-icon-btn">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {q.trim().length >= 2 ? (
        <ul className="du-picker-list">
          {busy && !hits.length ? <li className="du-picker-empty">Searching…</li> : null}
          {!busy && !hits.length ? <li className="du-picker-empty">No deal matches “{q.trim()}”.</li> : null}
          {hits.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onPick(d)} className="du-deal-option">
                <span className="du-deal-code">{d.code}</span>
                <span className="du-deal-title">{d.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Confirm card for an off-mail update Copilot understood. Every field can be corrected;
 * nothing is saved until "Confirm & save". After saving it offers Undo.
 */
export function DealUpdateCard({
  proposal,
  state,
  onState,
}: {
  proposal: DealUpdateProposal;
  state: DealUpdateCardState;
  onState: (s: DealUpdateCardState) => void;
}) {
  const [type, setType] = useState<DealUpdateType>(proposal.type);
  const [deal, setDeal] = useState<DealUpdateDealRef | null>(proposal.deal);
  const [picking, setPicking] = useState(false);
  const [po, setPo] = useState<string>(proposal.po || proposal.deal?.pos[0] || "");
  const [channel, setChannel] = useState<DealUpdateChannel>(proposal.channel);
  const [note, setNote] = useState(proposal.note);
  const [author, setAuthor] = useState("");
  const [payment, setPayment] = useState<DealUpdatePayment>(
    proposal.payment || { kind: "payment_received", side: "buyer", amount: null, currency: proposal.deal?.currency || "USD", date: today(), reference: null },
  );
  const [amountText, setAmountText] = useState(proposal.payment?.amount != null ? String(proposal.payment.amount) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAuthor(storedAuthor()), []);

  const pickDeal = (d: DealUpdateDealRef) => {
    setDeal(d);
    setPo(d.pos[0] || "");
    if (!proposal.payment?.currency && d.currency) setPayment((p) => ({ ...p, currency: d.currency! }));
    setPicking(false);
    setError(null);
  };

  const amount = Number(amountText.replace(/,/g, ""));
  const amountOk = Number.isFinite(amount) && amount > 0;
  const noPo = type === "payment" && deal && !deal.pos.length;
  const problems: string[] = [];
  if (!deal) problems.push("Pick the deal");
  if (type === "payment") {
    if (!amountOk) problems.push("Enter the amount");
    if (deal && !po) problems.push(noPo ? "This deal has no PO — save it as a note" : "Pick the PO");
    if (!payment.date) problems.push("Enter the date");
  } else if (!note.trim()) problems.push("Write what happened");
  const ready = problems.length === 0;

  const preview = useMemo(
    () =>
      describeUpdate({
        type,
        channel,
        note,
        po: type === "payment" ? po : null,
        payment: type === "payment" ? { ...payment, amount: amountOk ? amount : null } : null,
      }),
    [type, channel, note, po, payment, amount, amountOk],
  );

  async function confirm() {
    if (!ready || busy || !deal) return;
    setBusy(true);
    setError(null);
    try {
      rememberAuthor(author);
      const { update } = await postUpdates<{ update: DealUpdateRecord }>({
        action: "apply",
        confirmed: true,
        id: proposal.id,
        type,
        dealId: deal.id,
        po: type === "payment" ? po : po || null,
        channel,
        note: note.trim(),
        author: author.trim() || "team",
        payment: type === "payment" ? { ...payment, amount } : null,
        sourceText: proposal.note,
      });
      emitDealUpdatesChanged(update);
      onState({ status: "saved", update });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the update.");
    } finally {
      setBusy(false);
    }
  }

  async function undo(update: DealUpdateRecord) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postUpdates<{ update: DealUpdateRecord }>({ action: "undo", id: update.id, by: storedAuthor() || "team" });
      emitDealUpdatesChanged(res.update);
      onState({ status: "saved", update: res.update });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo.");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------- after saving */
  if (state.status === "saved") {
    const u = state.update;
    const undone = Boolean(u.voidedAt);
    return (
      <div className={cn("du-card", undone ? "du-card-muted" : "du-card-done")} role="status" aria-live="polite">
        <div className="du-done-head">
          <span className={cn("du-done-icon", undone && "du-done-icon-muted")}>
            {undone ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="du-done-title">{undone ? "Update undone" : `Saved to ${u.dealCode}`}</p>
            <p className={cn("du-done-text", undone && "line-through")}>{u.summary}</p>
          </div>
        </div>
        {!undone ? (
          <p className="du-done-foot">
            {u.type === "payment"
              ? "Added to the deal's payment ledger and team notes. The deal owner is notified and it shows on Command Center."
              : "Added to the deal's team notes and Command Center. Copilot and reply drafts will use it."}
          </p>
        ) : null}
        {error ? <p className="du-error">{error}</p> : null}
        <div className="du-actions">
          <Link href={u.href} className="du-link">
            Open {u.dealCode}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
          {!undone ? (
            <button type="button" onClick={() => void undo(u)} disabled={busy} className="du-text-btn">
              <RotateCcw className="h-3 w-3" aria-hidden />
              {busy ? "Undoing…" : "Undo"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state.status === "cancelled") {
    return (
      <div className="du-card du-card-muted">
        <p className="du-done-text">Not saved. Nothing on the deal changed.</p>
        <div className="du-actions">
          <button type="button" className="du-text-btn" onClick={() => onState({ status: "draft" })}>
            <Pencil className="h-3 w-3" aria-hidden /> Review again
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------- draft */
  return (
    <div className="du-card" aria-label="Confirm deal update">
      <div className="du-head">
        <span className="du-head-icon">{type === "payment" ? <Wallet className="h-3.5 w-3.5" /> : <NotebookPen className="h-3.5 w-3.5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="du-eyebrow">Check before saving</p>
          <p className="du-title">{type === "payment" ? `${PAYMENT_KIND_LABEL[payment.kind]} · ${formatMoney(amountOk ? amount : null, payment.currency)}` : "Team note"}</p>
        </div>
      </div>

      <Segmented<DealUpdateType>
        label="Update type"
        value={type}
        onChange={setType}
        options={[
          { value: "payment", label: "Payment", title: "Counts in the deal's payment ledger" },
          { value: "note", label: "Note only", title: "Saved as a team note; no money is booked" },
        ]}
      />

      {/* Deal */}
      <div className="du-field">
        <span className="du-label">Deal</span>
        {picking ? (
          <DealPicker onPick={pickDeal} onClose={() => setPicking(false)} />
        ) : deal ? (
          <div className="du-deal">
            <div className="min-w-0">
              <span className="du-deal-code">{deal.code}</span>
              <span className="du-deal-title">{deal.title}</span>
            </div>
            <button type="button" className="du-text-btn" onClick={() => setPicking(true)}>
              Change
            </button>
          </div>
        ) : (
          <>
            {proposal.dealHint ? (
              <p className="du-hint">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {proposal.dealHint}
              </p>
            ) : null}
            {proposal.candidates.length ? (
              <ul className="du-picker-list du-picker-list-inline">
                {proposal.candidates.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => pickDeal(d)} className="du-deal-option">
                      <span className="du-deal-code">{d.code}</span>
                      <span className="du-deal-title">{d.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="du-text-btn" onClick={() => setPicking(true)}>
              <Search className="h-3 w-3" aria-hidden /> Find a deal
            </button>
          </>
        )}
      </div>

      {type === "payment" ? (
        <>
          <div className="du-field">
            <span className="du-label">What happened</span>
            <Segmented
              label="What happened"
              value={payment.kind}
              onChange={(kind) => setPayment((p) => ({ ...p, kind }))}
              options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label, title: k.hint }))}
            />
          </div>
          <div className="du-grid">
            <label className="du-field">
              <span className="du-label">Amount</span>
              <div className="du-money">
                <select
                  aria-label="Currency"
                  value={payment.currency || "USD"}
                  onChange={(e) => setPayment((p) => ({ ...p, currency: e.target.value }))}
                >
                  {[...new Set([payment.currency || "USD", ...CURRENCIES])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="0"
                  aria-invalid={!amountOk}
                />
              </div>
            </label>
            <label className="du-field">
              <span className="du-label">Date</span>
              <input type="date" className="du-input" max={today()} value={payment.date} onChange={(e) => setPayment((p) => ({ ...p, date: e.target.value }))} />
            </label>
            <label className="du-field">
              <span className="du-label">Party</span>
              <select className="du-input" value={payment.side} onChange={(e) => setPayment((p) => ({ ...p, side: e.target.value as DealUpdatePayment["side"] }))}>
                {(["buyer", "factory", "freight", "commission", "other"] as const).map((s) => (
                  <option key={s} value={s}>
                    {SIDE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="du-field">
              <span className="du-label">PO</span>
              <select className="du-input" value={po} onChange={(e) => setPo(e.target.value)} disabled={!deal || !deal.pos.length}>
                {!deal ? <option value="">Pick a deal first</option> : !deal.pos.length ? <option value="">No PO on this deal</option> : null}
                {deal?.pos.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="du-field">
            <span className="du-label">Bank ref / UTR (optional)</span>
            <input className="du-input" value={payment.reference || ""} maxLength={60} onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value || null }))} placeholder="e.g. SBIN0012345678" />
          </label>
        </>
      ) : null}

      <div className="du-field">
        <span className="du-label">Where you heard it</span>
        <Segmented label="Where you heard it" value={channel} onChange={setChannel} options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
      </div>

      <label className="du-field">
        <span className="du-label">{type === "payment" ? "Note (optional)" : "What happened"}</span>
        <textarea className="du-input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <label className="du-field">
        <span className="du-label">Your name</span>
        <input className="du-input" value={author} maxLength={80} onChange={(e) => setAuthor(e.target.value)} placeholder="So the team knows who logged it" />
      </label>

      <div className="du-preview">
        <span className="du-label">Will save</span>
        <p>
          {deal ? <strong>{deal.code}: </strong> : null}
          {preview}
        </p>
        {type === "payment" ? <p className="du-preview-foot">Counts in the payment ledger and notifies the deal owner.</p> : null}
      </div>

      {error ? <p className="du-error" role="alert">{error}</p> : null}
      {!ready ? <p className="du-missing">{problems[0]}.</p> : null}

      <div className="du-actions">
        <button type="button" className="du-confirm" onClick={() => void confirm()} disabled={!ready || busy}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Saving…" : "Confirm & save"}
        </button>
        <button type="button" className="du-text-btn" onClick={() => onState({ status: "cancelled" })} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
