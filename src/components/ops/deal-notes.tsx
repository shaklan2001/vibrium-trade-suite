"use client";

import { useCallback, useEffect, useState } from "react";

type Note = { id: string; author: string; text: string; createdAt: string };

const AUTHOR_KEY = "trade.notes.author";

function storedAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) || "";
  } catch {
    return "";
  }
}

/** Off-mail context for a deal (call notes, buyer verbal instructions, factory updates). It feeds Copilot, reply drafts and the next-action agent. */
export function DealNotes({ dealKey }: { dealKey: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/mail/notes?deal=${encodeURIComponent(dealKey)}`, { cache: "no-store" });
      const j = (await r.json()) as { notes?: Note[] };
      setNotes(j.notes || []);
    } catch {
      setNotes([]);
    }
  }, [dealKey]);

  useEffect(() => {
    setAuthor(storedAuthor());
    void load();
  }, [load]);

  async function add() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/mail/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal: dealKey, author: author || "team", text }),
      });
      if (!r.ok) throw new Error("not saved");
      try {
        localStorage.setItem(AUTHOR_KEY, author);
      } catch {
        /* a remembered name is a convenience */
      }
      setText("");
      await load();
    } catch {
      setError("Could not save the note. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Team notes</h3>
      <p className="mt-0.5 text-xs text-zinc-500">Calls, buyer instructions, factory updates — things that are not in any email. Copilot and reply drafts use them.</p>
      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="e.g. Buyer said on call: ship 50% by air, balance by sea."
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name"
            maxLength={80}
            className="w-40 rounded-md border border-zinc-300 px-2 py-1 text-sm"
          />
          <button type="button" onClick={add} disabled={busy || !text.trim()} className="rounded-md bg-teal-700 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
            Add note
          </button>
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      </div>
      {notes.length ? (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
              {n.text}
              <div className="mt-0.5 text-xs text-zinc-500">
                {n.author} · {n.createdAt.slice(0, 10)}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
