"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Crown, Mail, RotateCcw, UserMinus, UserPlus, X } from "lucide-react";
import { storedAuthor } from "@/lib/trade/dealUpdateEvents";
import type { PeopleProposal } from "@/lib/trade/people/peopleCommands";

export type PeopleCardState = { status: "draft" | "saved" | "cancelled" | "undone"; error?: string };

async function post(body: Record<string, unknown>): Promise<string | null> {
  const r = await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, by: storedAuthor() || "team" }) });
  if (r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return j.error || "Could not save";
}

/** What the card will do, in one sentence. */
function describe(p: PeopleProposal): string {
  if (p.kind === "pin_owner") return `Make ${p.personName} the owner of ${p.deal.code}${p.currentOwner && p.currentOwner !== p.personName ? ` (now ${p.currentOwner})` : ""}.`;
  if (p.kind === "set_active")
    return p.active === "inactive"
      ? `Mark ${p.personName} as left. ${p.owns ? `The ${p.owns} deal${p.owns === 1 ? "" : "s"} ${p.personName} owns pass to the next person on each.` : ""}`
      : `Mark ${p.personName} as active again.`;
  return `Add ${p.email} to ${p.personName}: mail from it counts for ${p.personName}.${p.takenFrom ? ` It moves from ${p.takenFrom}.` : ""}`;
}

/** Confirm card for a team change told to Copilot ("Kalpana is handling PO …", "Yukta has left"). */
export function PeopleUpdateCard({ proposal, state, onState }: { proposal: PeopleProposal; state: PeopleCardState; onState: (s: PeopleCardState) => void }) {
  const [busy, setBusy] = useState(false);

  async function run(apply: boolean) {
    setBusy(true);
    const p = proposal;
    const err =
      p.kind === "pin_owner"
        ? await post({ action: "pin_owner", dealKey: p.deal.key, personId: apply ? p.personId : null })
        : p.kind === "set_active"
          ? await post({ action: "patch_persona", id: p.personId, active: apply ? p.active : p.previous })
          : await post({ action: "patch_persona", id: p.personId, ...(apply ? { addEmail: p.email } : { removeEmail: p.email }) });
    setBusy(false);
    onState(err ? { ...state, error: err } : { status: apply ? "saved" : "undone" });
  }

  const Icon = proposal.kind === "pin_owner" ? Crown : proposal.kind === "add_email" ? Mail : proposal.kind === "set_active" && proposal.active === "inactive" ? UserMinus : UserPlus;

  if (state.status === "cancelled") return <p className="du-card du-card-muted text-xs text-zinc-500">Cancelled — nothing changed.</p>;

  return (
    <div className={state.status === "saved" ? "du-card du-card-done" : "du-card"}>
      <div className="du-head">
        <span className={state.status === "saved" ? "du-done-icon" : "du-head-icon"} aria-hidden>
          {state.status === "saved" ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="du-eyebrow">{state.status === "saved" ? "Saved" : state.status === "undone" ? "Undone" : "Check before saving"}</p>
          <p className="du-title">{describe(proposal)}</p>
        </div>
      </div>
      {proposal.kind === "pin_owner" ? (
        <div className="du-deal">
          <div>
            <Link href={proposal.deal.href} className="du-deal-code">
              {proposal.deal.code}
            </Link>
            <p className="du-deal-title">{proposal.deal.title}</p>
          </div>
        </div>
      ) : null}
      <p className="du-done-text">
        {state.status === "saved"
          ? "Copilot and the Team & deals page use it now."
          : state.status === "undone"
            ? "Back to how it was."
            : "Owners are worked out from who replies and who the mail is sent to; this overrides that."}{" "}
        <Link href="/mailbox/people" className="du-link">
          Team & deals
        </Link>
      </p>
      {state.error ? <p className="du-error">{state.error}</p> : null}
      <div className="du-actions">
        {state.status === "draft" ? (
          <>
            <button type="button" className="du-confirm" disabled={busy} onClick={() => void run(true)}>
              {busy ? "Saving…" : "Confirm & save"}
            </button>
            <button type="button" className="du-text-btn" disabled={busy} onClick={() => onState({ status: "cancelled" })}>
              <X className="h-3 w-3" aria-hidden /> Cancel
            </button>
          </>
        ) : state.status === "saved" ? (
          <button type="button" className="du-text-btn" disabled={busy} onClick={() => void run(false)}>
            <RotateCcw className="h-3 w-3" aria-hidden /> {busy ? "Undoing…" : "Undo"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
