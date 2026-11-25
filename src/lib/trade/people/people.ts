/**
 * Who on the team works which deal, weighted by the mail — so "Radha's POs" means the deals Radha
 * actually handles, not every deal whose text mentions her.
 *
 * Every message on a deal is evidence. For each team person on it:
 *
 *   sent it        3      (the person is replying / doing the work)
 *   in To          1.5    (the mail was sent to them)
 *   Cc is ignored: being copied does not mean working the deal.
 *   × recency      halves every HALF_LIFE_DAYS (a mail from last week outweighs one from last year)
 *   + latest mail  the sender of the deal's newest message gets LATEST_SENDER_BONUS, its To gets
 *                  LATEST_TO_BONUS: whoever wrote last is the one handling it now
 *
 * Owner of a deal = the active person (not a shared mailbox) with the highest weight, unless someone
 * pinned an owner. A person who has not sent mail for INACTIVE_AFTER_DAYS is inactive (left, or
 * mailbox no longer used): they stay listed on their deals but never own one, so those deals fall to
 * the next person. Personas (name, extra addresses, shared / person, active) can be edited. Pure.
 */

import { isSystemSender } from "@/lib/mail/bounce";

export const WEIGHTS = { from: 3, to: 1.5 } as const;
export const HALF_LIFE_DAYS = 120;
export const LATEST_SENDER_BONUS = 4;
export const LATEST_TO_BONUS = 1;
export const INACTIVE_AFTER_DAYS = 60;

/** Team domains: anyone on these is a colleague. Other addresses join a persona only as its aliases. */
export const TEAM_DOMAINS = ["snspl.in"];

/** Team addresses that are a desk, not a person. */
const SHARED_LOCAL = /^(?:accounts?|occ|info|sales|admin|export|exports|docs|documents|shipping|logistics|ops|operations|purchase|support|noreply|no-reply|hr|finance|team|office|mail)$/i;

/** One message on a deal, as the index needs it. */
export type PeopleMessage = {
  id: string;
  dealKey: string;
  at: string;
  from: string | null;
  fromName?: string | null;
  to: string[];
  cc: string[];
  /** "Name <email>" pairs seen in the headers, to name people. */
  names?: Record<string, string>;
};

export type PersonaKind = "person" | "shared";
export type ActiveSetting = "auto" | "active" | "inactive";

/** What a person can edit (stored as a mail_record kind "persona"). */
export type PersonaEdit = {
  id: string;
  name?: string;
  title?: string;
  /** Every address this person uses (team address first). */
  emails?: string[];
  kind?: PersonaKind;
  active?: ActiveSetting;
  note?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type Persona = {
  id: string;
  name: string;
  title: string;
  emails: string[];
  kind: PersonaKind;
  active: ActiveSetting;
  note: string;
  edited: boolean;
};

export type DealRole = "owner" | "involved";

export type DealPerson = {
  personId: string;
  score: number;
  role: DealRole;
  sent: number;
  to: number;
  lastAt: string;
  lastAction: "sent" | "to";
  /** Sent the deal's newest message. */
  latestSender: boolean;
  /** Owner set by hand. */
  pinned: boolean;
};

export type PersonStats = Persona & {
  /** Active now (setting, or auto from lastSentAt). */
  isActive: boolean;
  lastSentAt: string | null;
  lastSeenAt: string | null;
  messages: number;
  owner: number;
  involved: number;
};

export type PeopleIndex = {
  builtAt: string;
  messagesRead: number;
  dealsRead: number;
  people: PersonStats[];
  /** dealKey → team people on it, owner first then by weight. */
  deals: Record<string, DealPerson[]>;
};

/** deal key → pinned owner person id (null = pin removed). */
export type OwnerPins = Record<string, string | null>;

// No quote in the local part: headers like "'Radha 'radha@snspl.in" must give radha@snspl.in.
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const DAY = 86_400_000;

export function emailsIn(text: string | null | undefined): string[] {
  return [...new Set((text || "").toLowerCase().match(EMAIL_RE) || [])];
}

/** "'Swinder Juneja' <swinder@snspl.in>, Radha <radha@snspl.in>" → { swinder@snspl.in: "Swinder Juneja", … } */
export function namesIn(text: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (text || "").matchAll(/(?:^|,)\s*["']?([^"'<>,@]{2,60}?)["']?\s*<([^<>\s]+@[^<>\s]+)>/g)) {
    const name = m[1]!.trim();
    if (name && !/@/.test(name)) out[m[2]!.toLowerCase()] = name;
  }
  return out;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);
const localOf = (email: string) => email.slice(0, email.indexOf("@"));
export const isTeamEmail = (email: string) => TEAM_DOMAINS.includes(domainOf(email.toLowerCase()));

const titleCase = (s: string) => s.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** Persona id for a team address: its local part ("radha@snspl.in" → "radha"). */
export const personaIdFor = (email: string) => localOf(email.toLowerCase()).replace(/[^a-z0-9]+/g, "-");

/**
 * Personas: one per team address seen, merged with the edits. A non-team address whose local part is
 * a team person's name plus the company ("radhasnspl@gmail.com") is taken as that person's alias.
 */
export function buildPersonas(messages: PeopleMessage[], edits: PersonaEdit[]): Persona[] {
  const seen = new Set<string>();
  const names: Record<string, Record<string, number>> = {};
  const vote = (email: string, name: string | null | undefined) => {
    if (!name || /@/.test(name)) return;
    const n = name.replace(/\s+/g, " ").trim();
    if (n.length < 2) return;
    (names[email] ||= {})[n] = (names[email]![n] || 0) + 1;
  };
  for (const m of messages) {
    for (const e of [m.from, ...m.to, ...m.cc]) if (e) seen.add(e.toLowerCase());
    if (m.from) vote(m.from.toLowerCase(), m.fromName);
    for (const [e, n] of Object.entries(m.names || {})) vote(e, n);
  }
  const byId = new Map<string, Persona>();
  // postmaster@ / mailer-daemon@ are the mail system, not people.
  for (const email of [...seen].filter((e) => isTeamEmail(e) && !isSystemSender(e)).sort()) {
    const id = personaIdFor(email);
    if (byId.has(id)) {
      byId.get(id)!.emails.push(email);
      continue;
    }
    const local = localOf(email);
    const best = Object.entries(names[email] || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    const cleanName = best ? best.replace(/\bsnspl\b/i, "").trim() : "";
    byId.set(id, {
      id,
      name: cleanName && cleanName.length > 1 ? titleCase(cleanName.toLowerCase()) : titleCase(local),
      title: "",
      emails: [email],
      kind: SHARED_LOCAL.test(local) ? "shared" : "person",
      active: "auto",
      note: "",
      edited: false,
    });
  }
  // Personal aliases: radhasnspl@gmail.com → radha.
  for (const email of seen) {
    if (isTeamEmail(email)) continue;
    const local = localOf(email).replace(/[^a-z]/g, "");
    const m = /^([a-z]{3,})snspl$|^snspl([a-z]{3,})$/.exec(local);
    const id = m?.[1] || m?.[2];
    const p = id ? byId.get(id) : undefined;
    if (p && p.kind === "person" && !p.emails.includes(email)) p.emails.push(email);
  }
  // Edits win: an address listed on an edited persona leaves any other persona.
  for (const e of edits) {
    const base = byId.get(e.id) || { id: e.id, name: titleCase(e.id), title: "", emails: [], kind: "person" as PersonaKind, active: "auto" as ActiveSetting, note: "", edited: true };
    const emails = e.emails?.length ? [...new Set(e.emails.map((x) => x.toLowerCase().trim()).filter((x) => /@/.test(x)))] : base.emails;
    for (const other of byId.values()) {
      if (other.id !== e.id) other.emails = other.emails.filter((x) => !emails.includes(x));
    }
    byId.set(e.id, {
      ...base,
      name: e.name?.trim() || base.name,
      title: e.title ?? base.title,
      emails,
      kind: e.kind || base.kind,
      active: e.active || base.active,
      note: e.note ?? base.note,
      edited: true,
    });
  }
  return [...byId.values()].filter((p) => p.emails.length);
}

/** The index: per deal, the team people on it with their weight and role; per person, totals. */
export function computePeopleIndex(
  messages: PeopleMessage[],
  edits: PersonaEdit[],
  pins: OwnerPins = {},
  now = new Date(),
): PeopleIndex {
  const personas = buildPersonas(messages, edits);
  const who = new Map<string, Persona>();
  for (const p of personas) for (const e of p.emails) who.set(e, p);

  // The same mail is copied into several mailboxes: count it once.
  const unique = new Map<string, PeopleMessage>();
  for (const m of messages) {
    const key = `${m.dealKey}|${m.id}`;
    if (!unique.has(key)) unique.set(key, m);
  }

  const lastSent = new Map<string, string>();
  const lastSeen = new Map<string, string>();
  const msgCount = new Map<string, number>();
  type Acc = { score: number; sent: number; to: number; lastAt: string; lastAction: DealPerson["lastAction"] };
  const perDeal = new Map<string, Map<string, Acc>>();
  const newest = new Map<string, PeopleMessage>();

  for (const m of unique.values()) {
    const t = Date.parse(m.at);
    if (!Number.isFinite(t)) continue;
    const prev = newest.get(m.dealKey);
    if (!prev || Date.parse(prev.at) < t) newest.set(m.dealKey, m);
    const decay = Math.max(0.05, Math.pow(0.5, Math.max(0, now.getTime() - t) / (HALF_LIFE_DAYS * DAY)));
    const touches: [string, keyof typeof WEIGHTS][] = [
      ...(m.from ? [[m.from, "from"] as [string, "from"]] : []),
      ...m.to.map((e) => [e, "to"] as [string, "to"]),
    ];
    const done = new Set<string>();
    for (const [email, kind] of touches) {
      const p = who.get(email.toLowerCase());
      if (!p || done.has(p.id)) continue;
      done.add(p.id);
      const deal = perDeal.get(m.dealKey) || new Map<string, Acc>();
      perDeal.set(m.dealKey, deal);
      const a = deal.get(p.id) || { score: 0, sent: 0, to: 0, lastAt: m.at, lastAction: kind === "from" ? "sent" : "to" };
      a.score += WEIGHTS[kind] * decay;
      if (kind === "from") a.sent += 1;
      else a.to += 1;
      if (Date.parse(m.at) >= Date.parse(a.lastAt)) {
        a.lastAt = m.at;
        a.lastAction = kind === "from" ? "sent" : "to";
      }
      deal.set(p.id, a);
      msgCount.set(p.id, (msgCount.get(p.id) || 0) + 1);
      if (!lastSeen.get(p.id) || lastSeen.get(p.id)! < m.at) lastSeen.set(p.id, m.at);
      if (kind === "from" && (!lastSent.get(p.id) || lastSent.get(p.id)! < m.at)) lastSent.set(p.id, m.at);
    }
  }

  const isActive = (p: Persona) => {
    if (p.active !== "auto") return p.active === "active";
    const s = lastSent.get(p.id);
    return Boolean(s && now.getTime() - Date.parse(s) <= INACTIVE_AFTER_DAYS * DAY);
  };
  const byId = new Map(personas.map((p) => [p.id, p]));

  const deals: Record<string, DealPerson[]> = {};
  for (const [dealKey, accs] of perDeal) {
    const last = newest.get(dealKey);
    const latestFrom = last?.from ? who.get(last.from.toLowerCase())?.id : undefined;
    const latestTo = new Set((last?.to || []).map((e) => who.get(e.toLowerCase())?.id).filter(Boolean));
    const rows: DealPerson[] = [...accs.entries()].map(([personId, a]) => ({
      personId,
      score: Math.round((a.score + (personId === latestFrom ? LATEST_SENDER_BONUS : 0) + (latestTo.has(personId) ? LATEST_TO_BONUS : 0)) * 100) / 100,
      role: "involved",
      sent: a.sent,
      to: a.to,
      lastAt: a.lastAt,
      lastAction: a.lastAction,
      latestSender: personId === latestFrom,
      pinned: false,
    }));
    rows.sort((x, y) => y.score - x.score);
    const pin = pins[dealKey];
    const pinned = pin ? rows.find((r) => r.personId === pin) : undefined;
    const owner =
      pinned ||
      rows.find((r) => {
        const p = byId.get(r.personId)!;
        return p.kind === "person" && isActive(p);
      });
    if (owner) {
      owner.role = "owner";
      owner.pinned = Boolean(pinned);
      rows.splice(rows.indexOf(owner), 1);
      rows.unshift(owner);
    } else if (pin && byId.has(pin)) {
      // Pinned to someone with no mail on the deal: still the owner.
      rows.unshift({ personId: pin, score: 0, role: "owner", sent: 0, to: 0, lastAt: last?.at || now.toISOString(), lastAction: "to", latestSender: false, pinned: true });
    }
    deals[dealKey] = rows;
  }

  const counts = new Map<string, { owner: number; involved: number }>();
  for (const rows of Object.values(deals)) {
    for (const r of rows) {
      const c = counts.get(r.personId) || { owner: 0, involved: 0 };
      c[r.role] += 1;
      counts.set(r.personId, c);
    }
  }
  const people: PersonStats[] = personas
    .map((p) => ({
      ...p,
      isActive: isActive(p),
      lastSentAt: lastSent.get(p.id) || null,
      lastSeenAt: lastSeen.get(p.id) || null,
      messages: msgCount.get(p.id) || 0,
      ...(counts.get(p.id) || { owner: 0, involved: 0 }),
    }))
    .sort((a, b) => Number(b.kind === "person") - Number(a.kind === "person") || b.owner - a.owner || b.involved - a.involved);

  return { builtAt: now.toISOString(), messagesRead: unique.size, dealsRead: perDeal.size, people, deals };
}

/**
 * The team person a question is about: "Radha's POs", "POs in radha email box", "kalpana ke deals".
 * Matches a persona's first name, id or address local part as a whole word.
 */
export function personInText(text: string, people: Pick<PersonStats, "id" | "name" | "emails" | "kind">[]): PersonStats["id"] | null {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/'s\b/g, "")
      .split(/[^a-z0-9@._-]+/)
      .filter(Boolean),
  );
  for (const p of people) {
    if (p.kind !== "person") continue;
    const keys = new Set([p.id, p.name.split(/\s+/)[0]!.toLowerCase(), ...p.emails.map((e) => localOf(e))]);
    for (const k of keys) if (k.length >= 3 && (words.has(k) || [...words].some((w) => w.includes("@") && w.startsWith(`${k}@`)))) return p.id;
  }
  return null;
}
