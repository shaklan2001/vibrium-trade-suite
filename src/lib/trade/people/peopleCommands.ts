/**
 * Team changes told to Copilot in plain words — shown as a confirm card, saved only on confirm:
 *
 *   "Kalpana is handling PO G2625146" / "make Kalpana owner of PO 15269"   → pin the deal's owner
 *   "Yukta has left" / "mark Sanjana inactive" / "Yukta is back"            → set active / inactive
 *   "add radhasnspl@gmail.com to Radha" / "Radha also uses …"              → add an address
 *
 * Questions ("who is handling PO 15269?") are left to the normal answer. Server only.
 */
import { randomUUID } from "node:crypto";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { dealHref } from "@/lib/trade/copilot/context";
import { parseCopilotQuery } from "@/lib/trade/copilot/query";
import { retrieveForQuery } from "@/lib/trade/copilot/retrieve";
import { findDealByRef } from "@/lib/trade/dealLink";
import { emailsIn, personInText, type ActiveSetting } from "./people";
import { getPeopleIndex } from "./peopleStore";

export type PeopleProposal = {
  id: string;
  personId: string;
  personName: string;
} & (
  | { kind: "pin_owner"; deal: { key: string; code: string; title: string; href: string }; currentOwner: string | null }
  | { kind: "set_active"; active: Exclude<ActiveSetting, "auto">; previous: ActiveSetting; owns: number }
  | { kind: "add_email"; email: string; takenFrom: string | null }
);

const QUESTION = /\?\s*$|^\s*(?:who|whom|whose|which|what|is|are|does|do|did|kaun|kon|kya)\b/i;
const OWNER_WORDS =
  /\b(?:owner|owns|handling|handles|handle|handled by|looks? after|looking after|in charge|responsible|assign(?:ed)?|take over|takes over|taking over|dekh (?:rahi|raha|rahe)|sambhal (?:rahi|raha|rahe)|handle kar)\b/i;
const LEFT = /\b(?:has left|left the company|no longer (?:with us|here|working)|resigned|quit|not working (?:here|with us)|mark(?:ed)? (?:\w+ )?inactive|inactive|chhod (?:diya|di|gayi|gaya)|chod (?:diya|di|gayi|gaya))\b/i;
const BACK = /\b(?:is back|came back|rejoined|re-joined|active again|mark(?:ed)? (?:\w+ )?active|wapas aa)\b/i;
const ADD_EMAIL = /\b(?:add|also uses?|uses|another (?:email|address|id)|alias|bhi)\b/i;

export async function proposePeopleUpdate(text: string, ctx: { focusDealId?: string } = {}): Promise<PeopleProposal | null> {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 6 || t.length > 400 || QUESTION.test(t)) return null;
  const index = await getPeopleIndex();
  if (!index) return null;
  const personId = personInText(t, index.people);
  const person = personId ? index.people.find((p) => p.id === personId) : undefined;
  if (!person) return null;
  const base = { id: randomUUID(), personId: person.id, personName: person.name };

  // An address for this person.
  const email = emailsIn(t).find((e) => !person.emails.includes(e));
  if (email && ADD_EMAIL.test(t)) {
    const other = index.people.find((p) => p.emails.includes(email));
    return { ...base, kind: "add_email", email, takenFrom: other?.name ?? null };
  }

  // Left / back.
  const first = person.name.split(/\s+/)[0]!.replace(/[^a-z]/gi, "");
  const nameLeft = first.length >= 3 && new RegExp(`\\b${first}\\s+(?:has\\s+|had\\s+)?left\\b(?!\\s+(?:the\\s+)?(?:docs?|documents?|files?|mail|message|note|samples?))`, "i").test(t);
  if ((LEFT.test(t) || nameLeft) && !OWNER_WORDS.test(t)) {
    return { ...base, kind: "set_active", active: "inactive", previous: person.active, owns: person.owner };
  }
  if (BACK.test(t)) return { ...base, kind: "set_active", active: "active", previous: person.active, owns: person.owner };

  // Owner of a deal: the deal named in the message, else the one on screen.
  if (!OWNER_WORDS.test(t)) return null;
  const book = await getCopilotBook();
  const q = parseCopilotQuery(t);
  let deal = null;
  if (q.poNumbers.length || q.dealCodes.length || q.bookingNumbers.length || q.containerNumbers.length) {
    const r = retrieveForQuery(book, { ...q, terms: [], intent: "deal" }, {});
    if (r.mode === "deal" && r.deals.length) deal = r.deals[0]!;
  }
  if (!deal && ctx.focusDealId) deal = book.byId.get(ctx.focusDealId) || findDealByRef(book.deals, ctx.focusDealId) || null;
  if (!deal) return null;
  const key = deal.mailboxSourceId || deal.id;
  const owner = index.deals[key]?.find((r) => r.role === "owner");
  const ownerName = owner ? index.people.find((p) => p.id === owner.personId)?.name ?? owner.personId : null;
  if (owner?.personId === person.id && owner.pinned) return null; // already so
  return {
    ...base,
    kind: "pin_owner",
    deal: { key, code: deal.code, title: deal.title.slice(0, 120), href: dealHref(deal) },
    currentOwner: ownerName,
  };
}
