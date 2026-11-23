/**
 * Who to greet. A sender name that is a company or a shared mailbox ("Swastik Impex",
 * "export2@…", "Accounts") is not a person. The person's name comes from, in order:
 *   1. how our side greeted them earlier in the thread ("Dear Narsi ji,"),
 *   2. their signature (a name line after "Regards" / "Thanks").
 * Pure; used by the reply prompt.
 */
import type { InboxMessage } from "./inboxTypes";

const COMPANY_WORDS =
  /\b(impex|exports?|imports?|industries|international|enterprises?|overseas|trading|traders|textiles?|handicrafts?|arts?|wares|products|designs?|pets?|team|accounts?|sales|support|info|admin|office|logistics|shipping|freight|llc|inc|ltd|pvt|limited|corp|company|co\.?)\b/i;
const SHARED_LOCAL = /^(info|sales|accounts?|admin|support|export\d*|exports|import\d*|office|contact|hello|team|mail|enquiry|inquiry|orders?|logistics|ops|operations|hr|billing)\d*$/i;
const GREETING = /^\s*(?:[Dd]ear|[Hh]i|[Hh]ello|[Hh]ey)\s+([A-Z][a-z]{1,20})(?:\s+(?:ji|sir|bhai|madam))?\s*[,:!-]?\s*$/m;
const CLOSING = /^\s*(?:regards|best regards|warm regards|kind regards|thanks(?: and regards)?|thank you|sincerely|with regards|br)[,.!]?\s*$/im;
const NAME_LINE = /^[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){0,2}$/;

function looksLikePerson(name: string): boolean {
  const clean = name.replace(/["']/g, "").trim();
  if (!clean || clean.includes("@")) return false;
  if (COMPANY_WORDS.test(clean)) return false;
  const words = clean.split(/\s+/);
  return words.length <= 3 && words.every((w) => /^[A-Za-z.]+$/.test(w));
}

function cap(word: string) {
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** Name from the first line after the closing word of a mail, when that line looks like a name. */
export function signatureName(body: string): string | null {
  const text = body.replace(/\r/g, "");
  const m = CLOSING.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length).split("\n").map((l) => l.trim()).filter(Boolean);
  const line = rest[0];
  if (!line || line.length > 40 || !NAME_LINE.test(line) || COMPANY_WORDS.test(line)) return null;
  return cap(line.split(/\s+/)[0]!);
}

/** First name used for them by our side earlier in the thread. */
export function nameFromOurGreetings(thread: InboxMessage[], theirEmail: string): string | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i]!;
    if (!m.internal) continue;
    // Only greetings in mails we sent to this person.
    if (theirEmail && !`${m.to} ${m.cc}`.toLowerCase().includes(theirEmail.toLowerCase())) continue;
    const g = GREETING.exec(m.body.slice(0, 200));
    if (g) return cap(g[1]!);
  }
  return null;
}

/**
 * First name to greet the sender of the newest mail, or null when nothing reliable is known
 * (the caller then falls back to the sender name or the neutral greeting).
 */
export function greetName(latest: InboxMessage, thread: InboxMessage[]): string | null {
  const local = latest.from.split("@")[0] || "";
  const sharedMailbox = SHARED_LOCAL.test(local);
  if (looksLikePerson(latest.fromName) && !sharedMailbox) return cap(latest.fromName.replace(/["']/g, "").trim().split(/\s+/)[0]!);
  return nameFromOurGreetings(thread, latest.from) || signatureName(latest.body) || null;
}
