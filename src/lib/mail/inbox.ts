import type { InboxMessage, InboxOutcome } from "./inboxTypes";

/**
 * Shared helpers for the agent inbox (src/lib/mail/outlookInbox.ts): body
 * cleanup and the "what does a person need to do" outcome for deal threads.
 */

const BODY_CAP = 4000;

const NOISE_SUBJECT =
  /^(automatic reply|auto(-|\s)?reply|out of office|undeliverable|delivery status notification|read:|accepted:|declined:|invitation:)/i;
const NOISE_SENDER = /no-?reply|noreply|mailer-daemon|postmaster|notification/i;
const QUOTE_START =
  /^(On .{5,200}wrote:|From: .+|-----Original Message-----|_{10,}|>.*)$/m;

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

export function freshText(body: string) {
  const text = (body || "").replace(/\r/g, "");
  const m = QUOTE_START.exec(text);
  const fresh = (m ? text.slice(0, m.index) : text).replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  const out = fresh || text.trim();
  return out.length > BODY_CAP ? `${out.slice(0, BODY_CAP)}\n…` : out;
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
