/**
 * Talkback (Option B): speak the cleaned assistant reply with browser
 * speechSynthesis. Kept thin so a future session-gated /api/tts can replace
 * speakAssistantReply / cancelTalkback without touching the Copilot wiring.
 */

/** Spoken replies longer than this are cut at a sentence boundary. */
export const TALKBACK_MAX_CHARS = 700;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&rarr;": " to ",
  "&ndash;": "-",
  "&mdash;": ", ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => {
      if (m in ENTITIES) return ENTITIES[m];
      const num = /^&#(\d+);$/.exec(m);
      return num ? String.fromCharCode(Number(num[1])) : " ";
    });
}

/**
 * Markdown → plain prose that sounds natural when read aloud.
 * Tables and code are visual-only and are dropped, not narrated.
 */
export function toSpeakableText(markdown: string, maxChars = TALKBACK_MAX_CHARS): string {
  if (!markdown) return "";
  let text = markdown.replace(/\r\n/g, "\n");

  // Code fences (any language) and inline HTML.
  text = text.replace(/```[\s\S]*?(```|$)/g, " ");
  text = text.replace(/<[^>]+>/g, " ");

  const lines = text.split("\n").map((raw) => {
    let line = decodeEntities(raw).trim();
    if (!line) return "";
    // Tables / separators / horizontal rules are visual only.
    if (/^\|.*\|?$/.test(line)) return "";
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return "";
    line = line
      .replace(/^#{1,6}\s+/, "") // headings
      .replace(/^>\s?/, "") // blockquote
      .replace(/^[-*+•]\s+/, "") // bullets
      .replace(/^\d+[.)]\s+/, "") // ordered list markers
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
      .replace(/https?:\/\/\S+/g, " ") // bare urls
      .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2") // italic
      .replace(/`([^`]*)`/g, "$1") // inline code
      .replace(/[*_~`#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) return "";
    // Give each line a spoken pause.
    return /[.!?:;,]$/.test(line) ? line : `${line}.`;
  });

  text = lines
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.!?])\.+/g, "$1")
    .trim();

  return clampAtSentence(text, maxChars);
}

function clampAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastStop = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (lastStop > maxChars * 0.4) return slice.slice(0, lastStop + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : maxChars).trim()}…`;
}

/** Split into chunks under ~220 chars — Chrome stalls on long utterances. */
export function chunkForSpeech(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    if (s.length > max) {
      // Very long sentence: break on commas / spaces.
      let rest = s;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max));
        const at = cut > max * 0.4 ? cut + 1 : max;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      cur = rest;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

export function isTalkbackSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

let generation = 0;

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return now;
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 800);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const byLang = (lang: string) =>
    voices.filter((v) => v.lang?.replace("_", "-").toLowerCase() === lang);
  const inVoices = byLang("en-in");
  if (inVoices.length) return inVoices.find((v) => v.localService) ?? inVoices[0];
  const us = byLang("en-us");
  if (us.length) return us.find((v) => v.localService) ?? us[0];
  return voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ?? null;
}

/** Stop any in-flight talkback. Pending speakAssistantReply calls resolve. */
export function cancelTalkback(): void {
  generation += 1;
  if (isTalkbackSupported()) window.speechSynthesis.cancel();
}

/**
 * Speak `text` (already cleaned with toSpeakableText).
 * Resolves on end, interrupt, or cancel; rejects only on real synthesis failure.
 */
export async function speakAssistantReply(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  if (!isTalkbackSupported()) throw new Error("Speech synthesis unsupported");

  cancelTalkback();
  const myGen = generation;
  const synth = window.speechSynthesis;
  const voice = pickVoice(await loadVoices());
  if (myGen !== generation) return;

  for (const chunk of chunkForSpeech(clean)) {
    if (myGen !== generation) return;
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-IN";
      }
      u.rate = 1;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = (ev) => {
        const err = (ev as SpeechSynthesisErrorEvent).error;
        if (err === "interrupted" || err === "canceled" || myGen !== generation) {
          resolve();
        } else {
          reject(new Error(`Speech synthesis failed: ${err || "unknown"}`));
        }
      };
      synth.speak(u);
      // Safari/Chrome sometimes stay paused after a cancel.
      if (synth.paused) synth.resume();
    });
  }
}
