"use client";

import { useEffect } from "react";

const EVERY_MS = 3 * 60 * 1000;
const FIRST_MS = 15_000;

/**
 * Free-tier stand-in for a frequent cron: while anyone has the suite open,
 * nudge /api/mail/sync every few minutes. The server skips inboxes synced in
 * the last 2 minutes and holds a per-inbox lock, so many open tabs are fine.
 * Stops quietly when mail sync isn't configured (503).
 */
export function MailAutoSync() {
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    async function tick() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/mail/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auto: true }),
          });
          if (res.status === 503) return;
        } catch {
          // network blip — try next tick
        }
      }
      timer = window.setTimeout(tick, EVERY_MS);
    }

    timer = window.setTimeout(tick, FIRST_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
