import { NextResponse } from "next/server";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { MAIL_LIMITS } from "@/lib/mail/config";
import { decryptSecret } from "@/lib/mail/crypto";
import { googleRevoke, googleStopWatch } from "@/lib/mail/providers/google";
import { microsoftUnsubscribe } from "@/lib/mail/providers/microsoft";
import { getMailStore } from "@/lib/mail/store";
import { toPublicConnection } from "@/lib/mail/sync";
import type { MailFilterMode } from "@/lib/mail/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH — pause/resume, backfill window, relevance filter. */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      status?: "active" | "paused";
      backfill_days?: number;
      filter_mode?: MailFilterMode;
    };
    const store = getMailStore();
    const row = await store.getConnection(id);
    if (!row) return jsonError("Not found", 404);

    if (body.status === "active" || body.status === "paused") {
      row.status = body.status;
      if (body.status === "active") row.last_error = null;
    }
    if (body.filter_mode === "trade" || body.filter_mode === "all") {
      row.settings_json = { ...row.settings_json, filter_mode: body.filter_mode };
    }
    if (body.backfill_days != null) {
      const days = Math.min(Math.max(Math.round(Number(body.backfill_days)) || 1, 1), MAIL_LIMITS.maxBackfillDays);
      const widened = days > Number(row.settings_json.backfill_days || MAIL_LIMITS.defaultBackfillDays);
      row.settings_json = { ...row.settings_json, backfill_days: days };
      // Re-list the wider window next sync; stored ids dedupe what we already have.
      if (widened) row.cursor_json = { ...row.cursor_json, synced_through: undefined };
    }
    await store.saveConnection(row);
    return NextResponse.json({ connection: toPublicConnection(row) }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * DELETE — stop push, revoke the grant, drop stored raw messages.
 * Deals already in the book stay (they are business records, not mail copies).
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const store = getMailStore();
    const row = await store.getConnection(id);
    if (!row) return jsonError("Not found", 404);
    try {
      const secret = decryptSecret(row.secret_enc);
      if (row.provider === "microsoft" && row.cursor_json.ms_subscription_id) {
        await microsoftUnsubscribe(secret, row.cursor_json.ms_subscription_id);
      }
      if (row.provider === "google") {
        await googleStopWatch(secret);
        await googleRevoke(secret);
      }
    } catch (err) {
      console.warn("[mail] provider cleanup failed", err);
    }
    await store.deleteConnection(id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
