/**
 * What Copilot learns from before drafting a reply (Stage 1 of the reply-accuracy plan):
 *
 *   - examples:     how the same person answered the most similar mails before
 *   - typicalWords: how long that person's replies usually are
 *   - dealNotes:    the deal as it stood when the mail arrived — other threads and
 *                   files received so far (never anything dated after the mail)
 *   - style:        that person's habits across all their past replies — how they open,
 *                   phrases they keep using, how often they ask a question or push urgency
 *
 * Pure and client-safe. The backtest builds the library from the deal book; the
 * inbox can build it from synced mail.
 */
import type { InboxMessage } from "./inboxTypes";

export type ReplyPair = {
  /** Reply author (our person), lower-case email. */
  by: string;
  threadKey: string;
  dealId?: string | null;
  subject: string;
  /** Their mail (fresh text). */
  theirs: string;
  /** Our reply (fresh text). */
  reply: string;
  /** When the reply was sent (ISO). */
  date: string;
};

export type ReplyExample = Pick<ReplyPair, "subject" | "theirs" | "reply" | "date">;

export type ReplyLearning = {
  examples: ReplyExample[];
  typicalWords: number | null;
  dealNotes: string | null;
  /** One-paragraph style profile of the person (see ReplyLibrary.style); absent when they have too few replies. */
  style?: string | null;
};

const STOP = new Set(
  ("a an and are as at be by for from has have i in is it of on or our please pls kindly the this to we with you your " +
    "dear hi hello regards thanks thank sir madam ji team mail email find attached below above will can let us know also " +
    "re fw fwd sent subject").split(" "),
);

export function tokens(text: string) {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter((w) => !STOP.has(w));
}

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

type Indexed = ReplyPair & { vec: Map<string, number>; norm: number; t: number };

/** TF-IDF index over past replies; lookups never return anything dated at/after `before`. */
export class ReplyLibrary {
  private items: Indexed[];
  private idf = new Map<string, number>();

  constructor(pairs: ReplyPair[]) {
    const df = new Map<string, number>();
    const bags = pairs.map((p) => {
      const tf = new Map<string, number>();
      for (const w of tokens(`${p.subject} ${p.subject} ${p.theirs}`)) tf.set(w, (tf.get(w) || 0) + 1);
      for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
      return tf;
    });
    const n = pairs.length || 1;
    for (const [w, d] of df) this.idf.set(w, Math.log(1 + n / d));
    this.items = pairs.map((p, i) => {
      const vec = this.weigh(bags[i]!);
      return { ...p, vec, norm: Math.hypot(...vec.values()) || 1, t: Date.parse(p.date) || 0 };
    });
  }

  get size() {
    return this.items.length;
  }

  private weigh(tf: Map<string, number>) {
    const out = new Map<string, number>();
    for (const [w, c] of tf) out.set(w, (1 + Math.log(c)) * (this.idf.get(w) || Math.log(2)));
    return out;
  }

  /** Most similar past mails this person answered (falls back to teammates when they have too few). */
  similar(q: { by: string; subject: string; theirs: string; before: string; excludeThreadKey?: string; k?: number }) {
    const k = q.k ?? 3;
    const cutoff = Date.parse(q.before) || Date.now();
    const tf = new Map<string, number>();
    for (const w of tokens(`${q.subject} ${q.subject} ${q.theirs}`)) tf.set(w, (tf.get(w) || 0) + 1);
    const vec = this.weigh(tf);
    const norm = Math.hypot(...vec.values()) || 1;
    const scored = this.items
      .filter((it) => it.t < cutoff && it.threadKey !== q.excludeThreadKey && wordCount(it.reply) >= 3)
      .map((it) => {
        let dot = 0;
        for (const [w, x] of vec) dot += x * (it.vec.get(w) || 0);
        return { it, score: dot / (norm * it.norm) + (it.by === q.by ? 0.15 : 0) };
      })
      .filter((s) => s.score > 0.2)
      .sort((a, b) => b.score - a.score);
    const picked: Indexed[] = [];
    const seenThreads = new Set<string>();
    for (const { it } of scored) {
      if (seenThreads.has(it.threadKey)) continue;
      seenThreads.add(it.threadKey);
      picked.push(it);
      if (picked.length >= k) break;
    }
    return picked.map(({ subject, theirs, reply, date }) => ({ subject, theirs, reply, date }));
  }

  /**
   * This person's habits across their replies before `before`, as prompt text: how they usually
   * open, phrases they keep using (3–5 word runs in at least 3 different replies), and how often
   * they ask a question or press for speed. Null with fewer than 8 replies.
   */
  style(by: string, before: string) {
    const cutoff = Date.parse(before) || Date.now();
    const mine = this.items.filter((it) => it.by === by && it.t < cutoff && wordCount(it.reply) >= 3);
    if (mine.length < 8) return null;
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9#/&' ]+/g, " ").replace(/\s+/g, " ").trim();
    const count = (grams: (r: string) => string[]) => {
      const c = new Map<string, number>();
      for (const it of mine) for (const g of new Set(grams(norm(it.reply)))) c.set(g, (c.get(g) || 0) + 1);
      return c;
    };
    const opens = count((r) => [r.split(" ").slice(0, 3).join(" ")]);
    const runs = count((r) => {
      const w = r.split(" ");
      const out: string[] = [];
      for (const n of [3, 4, 5]) for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
      return out;
    });
    const minHits = Math.max(3, Math.ceil(mine.length * 0.04));
    const top = (c: Map<string, number>, k: number) =>
      [...c.entries()]
        .filter(([g, n]) => n >= minHits && !/\d{3,}/.test(g))
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, k)
        .map(([g]) => g);
    // Keep the longest phrase of overlapping runs ("please share the" ⊂ "please share the revised").
    const phrases: string[] = [];
    for (const g of top(runs, 40)) {
      if (phrases.some((p) => p.includes(g) || g.includes(p))) continue;
      phrases.push(g);
      if (phrases.length >= 8) break;
    }
    const share = (re: RegExp) => Math.round((100 * mine.filter((it) => re.test(it.reply)).length) / mine.length);
    const lines = [
      `From ${mine.length} past replies by this person:`,
      top(opens, 3).length ? `- Usually opens with: ${top(opens, 3).map((o) => `"${o}…"`).join(", ")}` : "",
      phrases.length ? `- Phrases they often use: ${phrases.map((p) => `"${p}"`).join(", ")}` : "",
      `- ${share(/\?/)}% of replies ask a question; ${share(/\b(asap|urgent|urgently|immediately|today itself|at the earliest)\b/i)}% press for speed; ` +
        `${share(/\bbuyer\b/i)}% mention the buyer.`,
    ];
    return lines.filter(Boolean).join("\n");
  }

  /** Median length of this person's replies before `before`. */
  typicalWords(by: string, before: string) {
    const cutoff = Date.parse(before) || Date.now();
    const lens = this.items
      .filter((it) => it.by === by && it.t < cutoff)
      .map((it) => wordCount(it.reply))
      .sort((a, b) => a - b);
    if (lens.length < 5) return null;
    return lens[Math.floor(lens.length / 2)]!;
  }
}

/**
 * The deal as it stood when the mail arrived: the latest mails from its other
 * threads and the files received so far. Only messages dated before `before`.
 */
export function dealNotesAsOf(messages: InboxMessage[], before: string, excludeThreadKey: (m: InboxMessage) => boolean) {
  const cutoff = Date.parse(before) || Date.now();
  const earlier = messages.filter((m) => m.date && Date.parse(m.date) < cutoff);
  if (!earlier.length) return null;
  const other = earlier.filter((m) => !excludeThreadKey(m)).slice(-5);
  const files = [...new Set(earlier.flatMap((m) => m.attachments))].filter((n) => !/^image\d*\./i.test(n)).slice(-12);
  const lines: string[] = [];
  for (const m of other) {
    const text = m.body.replace(/\s+/g, " ").trim().slice(0, 240);
    lines.push(`- ${m.date?.slice(0, 10)} ${m.internal ? "US" : "THEM"} (${m.fromName || m.from}) “${m.subject}”: ${text}`);
  }
  if (files.length) lines.push(`- Files received or sent on this deal so far: ${files.join(", ")}`);
  return lines.length ? lines.join("\n") : null;
}
