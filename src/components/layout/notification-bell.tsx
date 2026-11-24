"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

type Notice = { id: string; owner: string; title: string; body: string; href: string; createdAt: string; readAt: string | null };

const WHO_KEY = "trade.notify.owner";
const POLL_MS = 60_000;

function stored() {
  try {
    return localStorage.getItem(WHO_KEY) || "";
  } catch {
    return "";
  }
}

/** Payment mails for the person who handles the order. "Me" is the SNSPL mailbox picked here (remembered in this browser). */
export function NotificationBell() {
  const [all, setAll] = useState<Notice[]>([]);
  const [me, setMe] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      const j = (await r.json()) as { notifications?: Notice[] };
      setAll(j.notifications || []);
    } catch {
      /* a missed poll is fine */
    }
  }, []);

  useEffect(() => {
    setMe(stored());
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const owners = [...new Set(all.map((n) => n.owner))].sort();
  const mine = me ? all.filter((n) => n.owner === me) : all;
  const unread = mine.filter((n) => !n.readAt).length;

  function pick(owner: string) {
    setMe(owner);
    try {
      localStorage.setItem(WHO_KEY, owner);
    } catch {
      /* optional */
    }
  }

  async function read(n: Notice) {
    setAll((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id, owner: n.owner }) }).catch(() => undefined);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-md p-1.5 hover:bg-zinc-100">
        <Bell className="h-4 w-4" />
        {unread ? <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-teal-700 px-1 text-[10px] leading-4 text-white">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          <select value={me} onChange={(e) => pick(e.target.value)} className="mb-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-xs" aria-label="Show notifications for">
            <option value="">Everyone</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {mine.length ? (
            <ul className="max-h-80 space-y-1 overflow-auto">
              {mine.slice(0, 30).map((n) => (
                <li key={n.id}>
                  <Link href={n.href || "/mailbox/inbox"} onClick={() => { void read(n); setOpen(false); }} className={`block rounded-md px-2 py-1.5 text-xs hover:bg-zinc-50 ${n.readAt ? "text-zinc-500" : "text-zinc-900"}`}>
                    <span className="font-medium">{n.title}</span>
                    {n.body ? <span className="block truncate">{n.body}</span> : null}
                    <span className="text-zinc-400">{n.owner.split("@")[0]} · {n.createdAt.slice(0, 10)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-xs text-zinc-500">No payment notifications yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
