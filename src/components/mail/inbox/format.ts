import type { InboxOutcome } from "@/lib/mail/inboxTypes";

/** Gmail-style: time for today, short date otherwise. */
export function listTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function fullTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function snippet(body: string, length = 120) {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

export function displayName(name: string, email: string) {
  return name || email.split("@")[0] || "Unknown";
}

const AVATAR = ["#0f766e", "#2563eb", "#c2410c", "#7c3aed", "#be123c", "#0369a1", "#4d7c0f", "#52525b"];

export function avatarFor(name: string, email: string) {
  const label = displayName(name, email);
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { initial: (label[0] || "?").toUpperCase(), color: AVATAR[h % AVATAR.length]! };
}

export const OUTCOME_STYLE: Record<InboxOutcome, string> = {
  draft_ready: "bg-teal-50 text-teal-800 ring-teal-200",
  needs_you: "bg-amber-50 text-amber-800 ring-amber-200",
  waiting: "bg-sky-50 text-sky-800 ring-sky-200",
  replied: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  fyi: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
