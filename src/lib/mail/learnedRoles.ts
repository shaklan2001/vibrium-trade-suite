/**
 * Sender roles learned from the deal book, for domains the static lists in classify.ts do not know.
 *
 * Every mail is one observation: a domain that sends a PO file is behaving like a buyer, one that
 * sends a PI / commercial invoice like a factory, one that sends BL / booking / AWB papers like a
 * forwarder. A domain gets a role when at least MIN_DEALS deals agree and the winning role has at
 * least MIN_SHARE of the votes. Each deal votes once per domain. Pure.
 */
import type { PartyRole } from "./classify";

export type RoleObservation = {
  dealKey: string;
  /** Sender address. */
  from: string;
  subject: string;
  /** Attachment file names. */
  files: string[];
  /** Sent by our side: not a counterparty. */
  internal?: boolean;
};

export type LearnedRoles = Record<string, PartyRole>;

export const MIN_DEALS = 2;
export const MIN_SHARE = 0.7;

const PUBLIC = new Set(["gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com", "rediffmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "qq.com", "163.com"]);

const BUYER_FILE = /\b(po|purchase[\s._-]*order)\b|^po[\s._#-]*\d/i;
const FACTORY_FILE = /\b(pi|proforma|invoice|inv|packing[\s._-]*list|pl)\b/i;
const FORWARDER_FILE = /\b(bl|hbl|mbl|awb|hawb|mawb|booking|telex|surrender|fcr|vgm|shipping[\s._-]*bill)\b/i;
const FORWARDER_SUBJECT = /\b(bkg|booking|awb|hbl|mbl|bl draft|vessel|etd|eta|sailing|surrender|telex)\b/i;

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : "";
}

/** The role one mail suggests, or null when it says nothing (a plain text reply). */
export function observedRole(o: RoleObservation): PartyRole | null {
  const files = o.files.join(" ");
  if (FORWARDER_FILE.test(files) || (!files && FORWARDER_SUBJECT.test(o.subject))) return "forwarder";
  if (BUYER_FILE.test(files) && !FACTORY_FILE.test(files.replace(BUYER_FILE, ""))) return "buyer";
  if (FACTORY_FILE.test(files)) return "factory";
  return null;
}

/** Roles for domains with enough agreeing deals. `known` domains (already classified) are skipped. */
export function learnRoles(observations: RoleObservation[], known: (email: string) => boolean = () => false): LearnedRoles {
  // domain → deal → role → count
  const votes = new Map<string, Map<string, Map<PartyRole, number>>>();
  for (const o of observations) {
    if (o.internal) continue;
    const domain = domainOf(o.from);
    if (!domain || PUBLIC.has(domain) || known(o.from)) continue;
    const role = observedRole(o);
    if (!role) continue;
    const deals = votes.get(domain) || new Map();
    const roles = deals.get(o.dealKey) || new Map();
    roles.set(role, (roles.get(role) || 0) + 1);
    deals.set(o.dealKey, roles);
    votes.set(domain, deals);
  }
  const out: LearnedRoles = {};
  for (const [domain, deals] of votes) {
    if (deals.size < MIN_DEALS) continue;
    const tally = new Map<PartyRole, number>();
    for (const roles of deals.values()) {
      const winner = [...roles.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      tally.set(winner, (tally.get(winner) || 0) + 1);
    }
    const [role, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (n / deals.size >= MIN_SHARE) out[domain] = role;
  }
  return out;
}
