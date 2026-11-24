import type { InboxMessage, InboxOutcome } from "./inboxTypes";

/**
 * Shared helpers for the agent inbox (src/lib/mail/outlookInbox.ts): body
 * cleanup and the "what does a person need to do" outcome for deal threads.
 */

const BODY_CAP = 4000;

const NOISE_SUBJECT =
  /^(automatic reply|auto(-|\s)?reply|out of office|undeliverable|delivery status notification|read:|accepted:|declined:|invitation:)/i;
const NOISE_SENDER = /no-?reply|noreply|mailer-daemon|postmaster|notification/i;
const QUOTE_BODY_LIMIT = 20_000;
const QUOTE_START =
  /^[ \t]*(?:On [^\n]{5,240}(?:\n[^\n]{0,160})?wrote:|From:[^\n]{0,200}\n(?:[^\n]{0,160}\n)?[ \t]*(?:Sent|Date):|From:[^\n]{0,200}@[^\n]{0,120}\n[ \t]*To:|From:[^\n]{1,160}\sSent:\s|-----Original Message-----|_{5,}|Get Outlook for (?:Android|iOS)|El [^\n]{0,180}escribi[oó]:|>.*)/im;
/** A reply header glued to the end of a signature line ("…GROUP LTDFrom: Narsi <n@x.com>" then "Sent:"). */
const GLUED_HEADER = /From:[ \t][^\n]{0,200}@[^\n]{0,120}\n(?:[^\n]{0,160}\n)?[ \t]*(?:Sent|Date):/i;

/** Where the quoted thread starts in `text` at or after `from`, or -1. */
function quoteStart(text: string, from = 0): number {
  const part = text.slice(from);
  const a = QUOTE_START.exec(part)?.index ?? -1;
  const b = GLUED_HEADER.exec(part)?.index ?? -1;
  const i = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  return i < 0 ? -1 : from + i;
}

export function parse<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function clipBody(text: string) {
  return text.length > BODY_CAP ? `${text.slice(0, BODY_CAP)}\n…` : text;
}

export function freshText(body: string, subject = "") {
  const text = (body || "").replace(/\r/g, "").slice(0, QUOTE_BODY_LIMIT);
  const start = quoteStart(text);
  const fresh = (start >= 0 ? text.slice(0, start) : text).replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  // A forward that is only "FYI" plus the original: the original is the message, but not the
  // older thread quoted under it.
  const forwarded = /(?:^|\s)(?:fw|fwd):/i.test(subject);
  if (forwarded && fresh.length < 40 && start >= 0) {
    const headerEnd = text.indexOf("\n\n", start);
    const older = headerEnd >= 0 ? quoteStart(text, headerEnd) : -1;
    const kept = older >= 0 ? text.slice(0, older) : text;
    return clipBody(kept.replace(/\n\s*\n\s*\n+/g, "\n\n").trim());
  }
  const out = fresh || text.trim();
  return clipBody(out);
}

export function outcomeFor(
  slot: string | null,
  result: Record<string, unknown>,
  confidence: number | null,
  latest: InboxMessage,
  repliedAfter: boolean,
): { outcome: InboxOutcome; note: string | null } {
  if (NOISE_SUBJECT.test(latest.subject) || NOISE_SENDER.test(latest.from)) {
    return { outcome: "fyi", note: "Automatic or calendar mail — no reply needed." };
  }
  if (repliedAfter) return { outcome: "replied", note: "Our team already replied after this mail." };
  if (confidence != null && confidence < 0.6) {
    return {
      outcome: "needs_you",
      note: `The agent is only ${Math.round(confidence * 100)}% sure about this thread — check the draft against the mail.`,
    };
  }
  if (slot === "inspection_photo_summarizer") {
    return { outcome: "needs_you", note: "Quality findings — decide what the factory must fix before replying." };
  }
  if (slot === "payment_clock") {
    return { outcome: "needs_you", note: "Money involved — confirm the payment status before replying." };
  }
  if (slot === "final_docs_pack_check" && result.complete === true) {
    return { outcome: "waiting", note: "Docs pack is complete — nothing to ask for right now." };
  }
  return { outcome: "draft_ready", note: null };
}
