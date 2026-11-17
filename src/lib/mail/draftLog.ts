/**
 * Live reply accuracy (Stage 2): every AI draft shown in the Inbox is logged, and when
 * the person sends, the sent text is stored next to it with how much they changed it.
 * Client-safe types + scoring; persistence lives in store.ts (table mail_reply_drafts).
 */
import { similarity } from "./replyEval";

export type EditLevel = "unchanged" | "light" | "heavy" | "rewritten";

export const EDIT_LEVEL_LABELS: Record<EditLevel, string> = {
  unchanged: "Sent as drafted",
  light: "Light edits",
  heavy: "Heavy edits",
  rewritten: "Rewritten",
};

export const EDIT_LEVEL_ORDER: EditLevel[] = ["unchanged", "light", "heavy", "rewritten"];

export type DraftLogInsert = {
  id: string;
  thread_key: string | null;
  deal_key: string | null;
  connection_id: string | null;
  message_id: string | null;
  signer: string | null;
  drafted_by: string;
  prompt_version: string | null;
  draft_body: string;
};

export type DraftLogRow = DraftLogInsert & {
  drafted_at: string;
  sent_body: string | null;
  sent_at: string | null;
  similarity: number | null;
  edit_level: EditLevel | null;
};

/**
 * How much the person changed the draft, from word-level ROUGE-L between the draft and
 * what was sent (greeting and sign-off ignored). Thresholds: ≥0.95 the same text,
 * ≥0.7 wording tweaks or one added point, ≥0.4 substance kept but reworked, below that a different reply.
 */
export function scoreEdit(draft: string, sent: string): { similarity: number; editLevel: EditLevel } {
  const s = similarity(sent, draft);
  const editLevel: EditLevel = s >= 0.95 ? "unchanged" : s >= 0.7 ? "light" : s >= 0.4 ? "heavy" : "rewritten";
  return { similarity: Math.round(s * 1000) / 1000, editLevel };
}

/** Replies sent with no or light edits count as "ready to send", the live twin of the backtest's usable rate. */
export function isReady(level: EditLevel | null) {
  return level === "unchanged" || level === "light";
}
