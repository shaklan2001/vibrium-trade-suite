"use client";

/** Browser helpers for /api/mail/sync (each call does ≤ ~50s of work). */

type SyncResponse = {
  connections?: {
    email: string;
    ingested?: number;
    remaining?: number;
    error?: string;
    skipped?: string;
  }[];
  jobs?: { started?: number; finalized?: number; failed?: number };
  error?: string;
};

export type SyncNowResult = {
  ingested: number;
  agentsStarted: number;
  agentsFinished: number;
  remaining: number;
  rounds: number;
  errors: string[];
  locked: boolean;
};

/**
 * "Sync now": keep calling the server in chunks until every inbox is caught
 * up (remaining = 0). Fits Vercel Hobby's 60s function limit.
 */
export async function syncMailNow(opts: {
  connectionId?: string;
  maxRounds?: number;
  onProgress?: (p: SyncNowResult) => void;
} = {}): Promise<SyncNowResult> {
  const out: SyncNowResult = {
    ingested: 0,
    agentsStarted: 0,
    agentsFinished: 0,
    remaining: 0,
    rounds: 0,
    errors: [],
    locked: false,
  };
  const maxRounds = opts.maxRounds ?? 20;
  for (let round = 0; round < maxRounds; round += 1) {
    const res = await fetch("/api/mail/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: opts.connectionId }),
    });
    const body = (await res.json().catch(() => ({}))) as SyncResponse;
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    out.rounds += 1;
    const conns = body.connections || [];
    out.ingested += conns.reduce((n, c) => n + (c.ingested || 0), 0);
    out.remaining = conns.reduce((n, c) => n + (c.remaining || 0), 0);
    out.agentsStarted += body.jobs?.started || 0;
    out.agentsFinished += body.jobs?.finalized || 0;
    out.locked = conns.some((c) => c.skipped === "locked");
    for (const c of conns) if (c.error) out.errors.push(`${c.email}: ${c.error}`);
    opts.onProgress?.({ ...out });
    if (out.errors.length || out.locked || out.remaining === 0) break;
  }
  return out;
}

export function describeSync(r: SyncNowResult) {
  const parts = [`${r.ingested} new message${r.ingested === 1 ? "" : "s"}`];
  if (r.agentsStarted) parts.push(`${r.agentsStarted} deal${r.agentsStarted === 1 ? "" : "s"} sent to agents`);
  if (r.agentsFinished) parts.push(`${r.agentsFinished} finished`);
  if (r.remaining) parts.push(`${r.remaining} still queued — press Sync again`);
  return parts.join(" · ");
}
