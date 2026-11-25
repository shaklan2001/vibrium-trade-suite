/**
 * Browser events that tie the Copilot's off-mail updates to the rest of the app:
 *   deal-updates:changed  an update was saved or undone, or a bank line matched → the feed, ledger, notes and bank lines reload
 *   copilot:open          open the floating Copilot (optionally with text in the composer)
 * Client only.
 */
import type { DealUpdateRecord } from "./dealUpdate";

const CHANGED = "deal-updates:changed";
const OPEN = "copilot:open";

/** `update` is absent when the change was not one update (e.g. a bank line reopened). */
export function emitDealUpdatesChanged(update: DealUpdateRecord | null = null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DealUpdateRecord | null>(CHANGED, { detail: update }));
}

export function onDealUpdatesChanged(cb: (update: DealUpdateRecord | null) => void): () => void {
  const fn = (e: Event) => cb((e as CustomEvent<DealUpdateRecord | null>).detail ?? null);
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

export type OpenCopilotDetail = { prefill?: string };

export function openCopilot(detail: OpenCopilotDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenCopilotDetail>(OPEN, { detail }));
}

export function onOpenCopilot(cb: (detail: OpenCopilotDetail) => void): () => void {
  const fn = (e: Event) => cb((e as CustomEvent<OpenCopilotDetail>).detail || {});
  window.addEventListener(OPEN, fn);
  return () => window.removeEventListener(OPEN, fn);
}

/** The name people sign notes with; shared with Team notes on the deal page. */
export const AUTHOR_KEY = "trade.notes.author";

export function storedAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || "";
  } catch {
    return "";
  }
}

export function rememberAuthor(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(AUTHOR_KEY, name.trim());
  } catch {
    /* a remembered name is a convenience */
  }
}
