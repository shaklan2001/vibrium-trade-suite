/**
 * Mail-driven early warnings: open items read from a deal's emails, which the field-based warnings
 * (payment due, sail date, documents, cut-offs) cannot see.
 *
 *   reply_owed           they asked or sent something that needs an answer; we have not replied
 *   waiting_on_them      we asked; they have not replied
 *   approval_pending     an approval was requested; nobody approved in the thread since
 *   issue_open           a shortage, damage, defect or rejection was raised; no resolution since
 *   payment_unconfirmed  a payment was requested (or sent) and nothing confirms it was paid (received)
 *
 * Each item keeps the date it started; how many days that is (and whether it is late yet) is worked
 * out when the warning is shown, so the stored items stay valid without re-reading mail every day.
 * Pure and client-safe.
 */
import type { PaymentEntry } from "./payments";
import { threadKeyFor } from "./thread";

export type MailSignalKind = "reply_owed" | "waiting_on_them" | "approval_pending" | "issue_open" | "payment_unconfirmed";

export type MailSignal = {
  kind: MailSignalKind;
  /** When the open item started (the mail that opened it). */
  since: string;
  /** Message id (internet Message-ID or sync ref) of that mail, for the email link. */
  messageId: string;
  /** The other side, as written on the mail (name or address). */
  party: string;
  subject: string;
  /** Short quote from the mail that opened it. */
  quote: string;
};

export type SignalMessage = {
  id: string;
  from: string;
  fromName: string;
  internal: boolean;
  date: string;
  subject: string;
  /** Newest text only (quoted history stripped). */
  body: string;
};

/** Older than this, an open item is almost always settled outside the mail (call, WhatsApp) — not shown. */
export const SIGNAL_STALE_DAYS = 21;

/** Days before an open item becomes a warning. */
export const SIGNAL_GRACE_DAYS: Record<MailSignalKind, number> = {
  reply_owed: 2,
  waiting_on_them: 4,
  approval_pending: 3,
  issue_open: 2,
  payment_unconfirmed: 7,
};

const AUTOMATED = /(no-?reply|mailer-daemon|postmaster|notification|donotreply|alerts?@|newsletter|calendar)/i;
const OUT_OF_OFFICE = /\b(out of office|automatic reply|auto-?reply|undeliverable|delivery status notification)\b/i;

/** Asks for something: a question or a request verb. */
const ASK =
  /\?|\b(please|pls|kindly)\s+(confirm|share|send|advise|check|approve|revert|update|arrange|provide|let (us|me) know|reply|clarify|review|expedite|proceed|book|release)\b|\b(request you|awaiting your|need your|let (us|me) know|can you|could you|would you|when (will|can)|any update|status (of|on))\b|(^|[.!\n]\s*)(did|have|has|is|are|was|were|will|do|does) (you|we|the|this|it)\b/i;
/** Chasing or waiting: something is still outstanding even without a direct question. */
const CHASE =
  /\b(still waiting|waiting for|awaiting|pending (from|with|at)|not (yet )?received|have not received|haven't received|yet to (receive|get)|gentle reminder|reminder|following up|follow(ing)? up|despite (two|2|several|multiple|repeated) (requests|reminders)|as soon as possible|asap|urgent(ly)?)\b/i;
/** Money that should have arrived and has not. */
const PAYMENT_MISSING =
  /\b(payment|amount|remittance|funds?)\b[^.]{0,60}\b(not (yet )?(been )?(received|reflected|credited)|still pending|outstanding|overdue|awaited)\b|\b(not (yet )?(received|reflected|credited))\b[^.]{0,40}\b(payment|amount|remittance|funds?)\b/i;

/** Forwarded for information only: nobody has to act. */
const FYI_ONLY = /\b(fyi|for your (information|info|reference|records)|just to inform|for information)\b/i;

/** A bare acknowledgement that needs no reply. */
const ACK_ONLY = /^\s*(thanks?( you)?|noted|well noted|ok(ay)?|received|thank you so much|many thanks|great|perfect|sure)[\s.!,]*(regards.*)?$/i;

const APPROVAL_ASK =
  /\b(for (your )?approval|please approve|kindly approve|approve the|awaiting (your )?approval|need (your )?approval|seeking approval|request(ing)? approval)\b|\bapproval\b[^.]{0,40}\b(pending|awaited|required|needed)\b/i;
const APPROVED = /\b(approved|approve[ds]? (it|this|the)|ok(ay)? to proceed|go ahead|you (may|can) proceed|please proceed|confirmed|approval (is )?given)\b/i;

const ISSUE =
  /\b(short(age)?s?|short[- ]shipped|damaged?|defect(s|ive)?|broken|missing (cartons?|pcs|pieces|items?|qty)|rejected|reject(ion)?|failed (the )?inspection|quality (issue|problem|complaint)|complaint|wrong (item|qty|quantity|colou?r|size|label))\b/i;
const RESOLVED = /\b(resolved|replace(d|ment)|credit note|debit note|compensat\w*|sorted|settled|rectif\w*|re-?shipped|accepted|closed)\b/i;

const DAY = 86_400_000;

function clean(text: string, n = 180) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** The sentence that triggered the item, for the warning text. */
function quoteOf(body: string, re: RegExp) {
  const sentences = body.replace(/\s+/g, " ").split(/(?<=[.?!])\s+/);
  return clean(sentences.find((s) => re.test(s)) || sentences[0] || "");
}

function head(body: string) {
  // Only the fresh message: drop signatures and legal footers that often contain "?" or "please".
  const cut = body.search(/\n\s*(regards|best regards|thanks (&|and) regards|warm regards|sincerely|sent from my)\b/i);
  return (cut > 0 ? body.slice(0, cut) : body).slice(0, 1500);
}

function party(m: SignalMessage) {
  return m.fromName || m.from;
}

/**
 * Open items in one deal's mail. `messages` are all the deal's emails (any order); `payments` are the
 * Payment Reader entries for this deal (optional).
 */
export function mailSignals(messages: SignalMessage[], payments: PaymentEntry[] = []): MailSignal[] {
  const mails = messages
    .filter((m) => m.date && !AUTOMATED.test(m.from) && !OUT_OF_OFFICE.test(m.subject))
    .sort((a, b) => a.date.localeCompare(b.date));
  const threads = new Map<string, SignalMessage[]>();
  for (const m of mails) {
    const key = threadKeyFor(m.subject, m.id);
    threads.set(key, [...(threads.get(key) || []), m]);
  }
  const out: MailSignal[] = [];
  const add = (kind: MailSignalKind, m: SignalMessage, re: RegExp, who: string) =>
    out.push({ kind, since: m.date, messageId: m.id, party: who, subject: m.subject, quote: quoteOf(head(m.body), re) });

  for (const thread of threads.values()) {
    const last = thread[thread.length - 1]!;
    const text = head(last.body);
    const lastExternal = [...thread].reverse().find((m) => !m.internal);

    // Who owes the next mail in this thread.
    // The run of mails at the end of the thread from the same side: the item is open since the first of them.
    let runStart = thread.length - 1;
    while (runStart > 0 && thread[runStart - 1]!.internal === last.internal) runStart--;
    const run = thread.slice(runStart);
    const needs = (t: string) => (ASK.test(t) ? ASK : CHASE.test(t) ? CHASE : APPROVAL_ASK.test(t) ? APPROVAL_ASK : ISSUE.test(t) ? ISSUE : null);
    const lastNeed = needs(text);
    const firstAsk = run.find((m) => needs(head(m.body))) || last;
    if (!last.internal && !ACK_ONLY.test(text) && !FYI_ONLY.test(text) && (lastNeed || run.some((m) => needs(head(m.body))))) {
      add("reply_owed", firstAsk, needs(head(firstAsk.body)) || ASK, party(last));
    } else if (last.internal && run.some((m) => ASK.test(head(m.body)) || CHASE.test(head(m.body)))) {
      const firstOurs = run.find((m) => ASK.test(head(m.body)) || CHASE.test(head(m.body)))!;
      add("waiting_on_them", firstOurs, ASK.test(head(firstOurs.body)) ? ASK : CHASE, lastExternal ? party(lastExternal) : "them");
    }

    // Money said to be missing, with no later mail saying it arrived.
    const missing = [...thread].reverse().find((m) => PAYMENT_MISSING.test(head(m.body)));
    const arrivedLater = (m: SignalMessage) =>
      /\b(received|credited|reflected|realised|realized)\b/i.test(head(m.body)) && !PAYMENT_MISSING.test(head(m.body));
    if (missing && !thread.some((m) => m.date > missing.date && arrivedLater(m))) {
      add("payment_unconfirmed", missing, PAYMENT_MISSING, party(missing.internal ? lastExternal || missing : missing));
    }

    // An approval asked for and never given in the thread.
    const asked = [...thread].reverse().find((m) => APPROVAL_ASK.test(head(m.body)) || APPROVAL_ASK.test(m.subject));
    if (asked && !thread.some((m) => m.date > asked.date && APPROVED.test(head(m.body)))) {
      add("approval_pending", asked, APPROVAL_ASK, party(asked.internal ? lastExternal || asked : asked));
    }

    // A problem raised and not resolved since.
    const issue = [...thread].reverse().find((m) => ISSUE.test(head(m.body)) || ISSUE.test(m.subject));
    if (issue && !thread.some((m) => m.date > issue.date && RESOLVED.test(head(m.body)))) {
      add("issue_open", issue, ISSUE, party(issue.internal ? lastExternal || issue : issue));
    }
  }

  // Payments: a request (or a "we have paid") with nothing after it that confirms payment.
  const pay = payments.filter((p) => p.status === "done" && p.kind && p.kind !== "other").sort((a, b) => a.mailDate.localeCompare(b.mailDate));
  const lastRequest = [...pay].reverse().find((p) => p.kind === "payment_request");
  if (lastRequest && !pay.some((p) => p.mailDate > lastRequest.mailDate && (p.kind === "payment_sent" || p.kind === "payment_received"))) {
    out.push({
      kind: "payment_unconfirmed",
      since: lastRequest.mailDate,
      messageId: lastRequest.id,
      party: lastRequest.payer || lastRequest.from,
      subject: lastRequest.subject,
      quote: clean(lastRequest.summary || "Payment requested"),
    });
  } else {
    const sent = [...pay].reverse().find((p) => p.kind === "payment_sent");
    if (sent && !pay.some((p) => p.mailDate > sent.mailDate && p.kind === "payment_received")) {
      out.push({
        kind: "payment_unconfirmed",
        since: sent.mailDate,
        messageId: sent.id,
        party: sent.payer || sent.from,
        subject: sent.subject,
        quote: clean(sent.summary || "Payment sent, receipt not confirmed"),
      });
    }
  }

  // Handled elsewhere in the deal: the conversation often continues in a different thread
  // ("Final documents…" answers the earlier "please send the invoice").
  const later = (s: MailSignal) => mails.filter((m) => m.date > s.since);
  const sameParty = (m: SignalMessage, s: MailSignal) => {
    const who = s.party.toLowerCase();
    return m.from === who || (m.fromName && m.fromName.toLowerCase() === who) || who.includes(m.from);
  };
  const handled = (s: MailSignal) => {
    const after = later(s);
    switch (s.kind) {
      case "reply_owed":
        // Anyone moving the deal on afterwards (us, or the forwarder sending what was asked) closes it.
        return after.length > 0;
      case "waiting_on_them":
        return after.some((m) => !m.internal && (sameParty(m, s) || !s.party || s.party === "them"));
      case "approval_pending":
        return after.some((m) => APPROVED.test(head(m.body)));
      case "issue_open":
        return after.some((m) => RESOLVED.test(head(m.body)));
      case "payment_unconfirmed":
        return after.some((m) => /\b(received|credited|reflected|realised|realized|paid)\b/i.test(head(m.body)) && !PAYMENT_MISSING.test(head(m.body)));
    }
  };
  for (let i = out.length - 1; i >= 0; i--) if (handled(out[i]!)) out.splice(i, 1);

  // One item per kind per thread is enough; keep the newest few per kind for the deal.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.since.localeCompare(a.since))
    .filter((s) => {
      const key = `${s.kind}|${threadKeyFor(s.subject, s.messageId)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

/** Days an item has been open, against `today` (YYYY-MM-DD). */
export function signalAgeDays(s: MailSignal, today: string) {
  return Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(s.since)) / DAY);
}
