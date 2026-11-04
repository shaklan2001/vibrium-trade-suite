import { after, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { deadlineIn, jsonError, mailSetupStatus, NO_STORE } from "@/lib/mail/api";
import { MAIL_LIMITS } from "@/lib/mail/config";
import { connectionId, encryptSecret } from "@/lib/mail/crypto";
import { verifyImap } from "@/lib/mail/providers/imap";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import { runMailCycle, toPublicConnection } from "@/lib/mail/sync";
import type { MailConnectionRow, MailFilterMode } from "@/lib/mail/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s; work is chunked (MAIL_REQUEST_BUDGET_S).
export const maxDuration = 60;

/** GET /api/mail/connections — connected inboxes (no secrets) + setup checklist. */
export async function GET() {
  const setup = mailSetupStatus();
  if (!mailStoreConfigured()) {
    return NextResponse.json({ setup, connections: [], jobs: {} }, { headers: NO_STORE });
  }
  try {
    const store = getMailStore();
    const [rows, stats, jobs] = await Promise.all([
      store.listConnections(),
      store.connectionStats(),
      store.jobCounts(),
    ]);
    return NextResponse.json(
      {
        setup,
        connections: rows.map((r) => toPublicConnection(r, stats[r.id])),
        jobs,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return NextResponse.json(
      {
        setup,
        connections: [],
        jobs: {},
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: NO_STORE },
    );
  }
}

/**
 * POST /api/mail/connections — connect an IMAP mailbox (app password).
 * OAuth providers connect via /api/mail/oauth/{provider}/start instead.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "mail-imap", 10, 60_000);
  if (limited) return limited;
  try {
    const body = (await req.json()) as {
      email?: string;
      host?: string;
      port?: number;
      secure?: boolean;
      user?: string;
      password?: string;
      backfill_days?: number;
      filter_mode?: MailFilterMode;
    };
    const email = (body.email || body.user || "").trim().toLowerCase();
    const host = (body.host || "").trim();
    const user = (body.user || email).trim();
    const password = body.password || "";
    const port = Number(body.port) || 993;
    if (!email.includes("@") || !host || !password) {
      return jsonError("email, host and password are required", 400);
    }
    if (!/^[a-z0-9.-]+$/i.test(host)) return jsonError("Invalid IMAP host", 400);

    const imap = { host, port, secure: body.secure !== false, user };
    await verifyImap(imap, password);

    const store = getMailStore();
    const id = connectionId("imap", email);
    const prev = await store.getConnection(id);
    const row: MailConnectionRow = {
      id,
      provider: "imap",
      email,
      display_name: prev?.display_name || null,
      status: "active",
      secret_enc: encryptSecret({ kind: "password", password }),
      settings_json: {
        ...(prev?.settings_json || {}),
        imap,
        backfill_days: Number(body.backfill_days) || prev?.settings_json.backfill_days || MAIL_LIMITS.defaultBackfillDays,
        filter_mode: body.filter_mode === "all" ? "all" : prev?.settings_json.filter_mode || "trade",
      },
      cursor_json: prev?.cursor_json || {},
      last_sync_at: prev?.last_sync_at || null,
      last_error: null,
    };
    await store.saveConnection(row);
    // First backfill runs after the response so the form returns immediately.
    after(() => runMailCycle({ connectionId: id, deadline: deadlineIn() }).catch(console.error));
    return NextResponse.json({ connection: toPublicConnection(row) }, { headers: NO_STORE });
  } catch (err) {
    const status = err instanceof Error && err.name === "MailAuthError" ? 401 : 500;
    return jsonError(err, status);
  }
}
