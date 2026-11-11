/**
 * Segment-aware merge of streaming STT into a single composer draft.
 *
 * STT engines revise hypotheses in place. Appending every interim produces
 * stutter like "From Gurjari From Gurga From Gurgaon". Instead we keep an
 * insertion-ordered map of segment → latest text and replace on revision.
 */

export type VoiceDraftState = {
  /** Insertion-ordered segment key → latest text. */
  segments: Map<string, string>;
  /** Key of the most recent segment that has not been finalised yet. */
  interimKey: string | null;
  /** Text and key of the most recent finalised segment. */
  lastFinal: string;
  lastFinalKey: string | null;
  /** Counter for synthetic keys of id-less finals. */
  anon: number;
};

export type VoiceSegmentMeta = { isFinal?: boolean; segmentId?: string };

const INTERIM_KEY = "__interim__";

export function createVoiceDraftState(): VoiceDraftState {
  return {
    segments: new Map(),
    interimKey: null,
    lastFinal: "",
    lastFinalKey: null,
    anon: 0,
  };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two tokens are "the same word" allowing STT spelling drift. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) {
    shared += 1;
  }
  return shared >= 3;
}

/**
 * True when `next` looks like a revision of `prev` (rather than new speech):
 * equal, prefix/substring, or ≥50% shared opening tokens with spelling drift.
 */
export function isTranscriptRevision(prev: string, next: string): boolean {
  const a = normalize(prev);
  const b = normalize(next);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const ta = a.split(" ");
  const tb = b.split(" ");
  let shared = 0;
  while (
    shared < ta.length &&
    shared < tb.length &&
    tokensMatch(ta[shared], tb[shared])
  ) {
    shared += 1;
  }
  const shorter = Math.min(ta.length, tb.length);
  return shared > 0 && shared / shorter >= 0.5;
}

/** Replace `oldKey` with `newKey` → `text` while keeping its position. */
function replaceKeyInPlace(
  segments: Map<string, string>,
  oldKey: string,
  newKey: string,
  text: string,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const [k, v] of segments) {
    if (k === oldKey) next.set(newKey, text);
    else if (k !== newKey) next.set(k, v);
  }
  return next;
}

export function voiceDraftText(state: VoiceDraftState): string {
  return [...state.segments.values()]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Apply one STT update and return the merged draft text.
 * Mutates `state`.
 */
export function applyVoiceSegment(
  state: VoiceDraftState,
  rawText: string,
  meta: VoiceSegmentMeta = {},
): string {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return voiceDraftText(state);
  const isFinal = Boolean(meta.isFinal);
  const id = meta.segmentId?.trim();

  if (id) {
    // Rule 1: id'd segments upsert. An open id-less interim that this id'd
    // segment revises is folded into it (same speech via a second path).
    const openKey = state.interimKey;
    if (
      openKey &&
      openKey !== id &&
      openKey === INTERIM_KEY &&
      isTranscriptRevision(state.segments.get(openKey) ?? "", text)
    ) {
      state.segments = replaceKeyInPlace(state.segments, openKey, id, text);
    } else {
      state.segments.set(id, text);
    }
    if (isFinal) {
      if (state.interimKey === id || state.interimKey === INTERIM_KEY) {
        state.interimKey = null;
      }
      state.lastFinal = text;
      state.lastFinalKey = id;
    } else {
      state.interimKey = id;
    }
    return voiceDraftText(state);
  }

  if (!isFinal) {
    // Rule 2: id-less interim → single synthetic slot, always replace.
    if (state.interimKey && state.interimKey !== INTERIM_KEY) {
      // An id'd interim is open; treat this as its revision if it looks like one.
      const cur = state.segments.get(state.interimKey) ?? "";
      if (isTranscriptRevision(cur, text)) {
        state.segments.set(state.interimKey, text);
        return voiceDraftText(state);
      }
    }
    state.segments.set(INTERIM_KEY, text);
    state.interimKey = INTERIM_KEY;
    return voiceDraftText(state);
  }

  // Rule 3: id-less final.
  const openKey = state.interimKey;
  if (openKey && isTranscriptRevision(state.segments.get(openKey) ?? "", text)) {
    const key = openKey === INTERIM_KEY ? `final-${++state.anon}` : openKey;
    state.segments = replaceKeyInPlace(state.segments, openKey, key, text);
    state.interimKey = null;
    state.lastFinal = text;
    state.lastFinalKey = key;
    return voiceDraftText(state);
  }

  if (
    state.lastFinalKey &&
    state.segments.has(state.lastFinalKey) &&
    isTranscriptRevision(state.lastFinal, text)
  ) {
    // Spelling correction / duplicate of the previous final.
    state.segments.set(state.lastFinalKey, text);
    state.lastFinal = text;
    return voiceDraftText(state);
  }

  const key = `final-${++state.anon}`;
  if (openKey === INTERIM_KEY) {
    // An id-less final closes the current id-less utterance even when the
    // heuristic misses: it supersedes the open interim hypothesis.
    state.segments = replaceKeyInPlace(state.segments, INTERIM_KEY, key, text);
    state.interimKey = null;
  } else {
    state.segments.set(key, text);
  }
  state.lastFinal = text;
  state.lastFinalKey = key;
  return voiceDraftText(state);
}
