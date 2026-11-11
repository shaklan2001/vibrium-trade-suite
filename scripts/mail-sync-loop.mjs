#!/usr/bin/env node
/**
 * Poll /api/mail/cron on a fixed interval — for local dev or any host without
 * Vercel Cron (EC2, a container, a laptop running `npm run dev`).
 *
 *   node --env-file=.env.local scripts/mail-sync-loop.mjs            # every 2 min
 *   MAIL_SYNC_EVERY=60 node --env-file=.env.local scripts/mail-sync-loop.mjs
 */
const base = (process.env.MAIL_SYNC_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
const every = Math.max(Number(process.env.MAIL_SYNC_EVERY || 120), 30) * 1000;

if (!secret) {
  console.error("CRON_SECRET is not set");
  process.exit(1);
}

async function tick() {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/mail/cron`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const conns = (body.connections || [])
      .map((c) => `${c.email}: +${c.ingested ?? 0}${c.error ? ` (${c.error})` : c.skipped ? ` (${c.skipped})` : ""}`)
      .join(", ");
    const j = body.jobs || {};
    console.log(
      `[${new Date().toISOString()}] ${conns || "no inboxes"} | agents started ${j.started ?? 0}, finished ${j.finalized ?? 0}, failed ${j.failed ?? 0} (${Math.round((Date.now() - started) / 1000)}s)`,
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] sync failed:`, err instanceof Error ? err.message : err);
  }
}

await tick();
setInterval(tick, every);
