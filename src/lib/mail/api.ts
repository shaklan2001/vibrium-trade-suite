import { NextResponse } from "next/server";
import { attachmentStoreConfigured } from "./parse";
import { mailCronSecret } from "./config";
import { mailStoreConfigured } from "./store";

export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export function jsonError(error: unknown, status = 500) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status, headers: NO_STORE },
  );
}

/** What is wired up — the connect page shows a checklist from this. */
export function mailSetupStatus() {
  const encryption = (process.env.MAIL_ENCRYPTION_KEY?.trim().length || 0) >= 16;
  const vibrium = Boolean(
    process.env.VIBRIUM_CUSTOMER_ID &&
      process.env.VIBRIUM_SERVICE_USERNAME &&
      process.env.VIBRIUM_SERVICE_PASSWORD,
  );
  return {
    database: mailStoreConfigured(),
    encryption,
    attachments: attachmentStoreConfigured(),
    vibrium,
    cron: Boolean(mailCronSecret()),
    /** e.g. snspl.in — mail from this domain counts as our side. */
    workspaceDomain: process.env.MAIL_WORKSPACE_DOMAIN?.trim().toLowerCase() || null,
  };
}

/**
 * Seconds of work a request may do before returning. Routes declare
 * maxDuration = 60 (Vercel Hobby), so the default leaves ~10s headroom;
 * anything unfinished continues on the next Sync now / auto-sync / cron call.
 */
export function deadlineIn(seconds?: number) {
  const budget = Number(process.env.MAIL_REQUEST_BUDGET_S) || 48;
  return Date.now() + Math.min(seconds ?? budget, budget) * 1000;
}
