/**
 * Links to one email in the shared inbox: /mailbox/inbox?deal=<short deal key>&mail=<ref>.
 *
 * `ref` is an 8-character fingerprint of the message id (internet Message-ID, or the sync
 * ref when there is none), so links stay short enough for Copilot answers and warning
 * cards. /api/mail/open resolves the pair back to the conversation. Client-safe.
 */
import { shortDealKey } from "@/lib/trade/dealLink";
import type { Deal } from "@/types/trade";

/** FNV-1a 32-bit, hex. Stable across server and browser. */
export function mailRef(messageId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < messageId.length; i++) {
    h ^= messageId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function mailHref(deal: Pick<Deal, "id" | "code">, messageId: string): string {
  return `/mailbox/inbox?deal=${encodeURIComponent(shortDealKey(deal))}&mail=${mailRef(messageId)}`;
}

/** The deal's newest email (resolved server-side) — for places that don't hold the deal's mail. */
export function latestMailHref(deal: Pick<Deal, "id" | "code">): string {
  return `/mailbox/inbox?deal=${encodeURIComponent(shortDealKey(deal))}&mail=latest`;
}
