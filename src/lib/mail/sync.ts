import type { ProcessedDealRow } from "@/lib/trade/processedDealMapper";
import {
  agentIdForSlot,
  chooseSlot,
  dealKeyFor,
  DOC_OPTIONAL,
  DOC_REQUIRED,
  isNoiseMessage,
  isRelevantDeal,
  partyRole,
  pickDocument,
  type ClassifyContext,
} from "./classify";
import { preferredStage, stageForSlot } from "./agentStage";
import { MAIL_LIMITS } from "./config";
import { decryptSecret } from "./crypto";
import { buildDealPack, buildEvidence, dealContextNotes, type DealPack } from "./dealPack";
import { presign } from "./attachmentUrl";
import { isBankStatementMail } from "./bankStatement";
import { ensureDocText } from "./docStore";
import { refreshSignals } from "./signalStore";
import { freshText } from "./inbox";
import { processStatements } from "./statementJobs";
import { markTakenFromMail, processNextActions, queueNextActions } from "./nextAction";
import { ensureLearnedRoles } from "./learnedRolesStore";
import { ocrEnabled, processOcr, startOcr, wantsOcr, wantsPaymentImageOcr } from "./ocr";
import { isPaymentCandidate, PAYMENT_IMAGE_MIN_BYTES } from "./payments";
import { paymentReaderId, paymentRowFor, processPayments, queueNewPayments, type PaymentRow } from "./paymentJobs";
import { parseRawMail, storeAttachment } from "./parse";
import { isRdsProxyEnabled } from "@/lib/rdsProxy";
import {
  documentExtractionEnabled,
  finalizeDealDocuments,
  planDealDocuments,
  startDealDocuments,
} from "@/lib/trade/documentExtraction";
import { MailAuthError, PROVIDER_SESSIONS } from "./providers";
import type { ProviderSession } from "./providers/types";
import { getMailStore, type MailStore, type ProcessedDealUpsert } from "./store";
import { folderForRef, threadKeyFor } from "./thread";
import type {
  MailConnectionPublic,
  MailConnectionRow,
  MailConnectionStats,
  MailDealJob,
  MailFilterMode,
  StoredAttachment,
  StoredMailMessage,
} from "./types";
import {
  executionCost,
  executionResult,
  getExecution,
  startExecution,
  TERMINAL,
} from "./workers";

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_CHAR_LIMIT = 24_000;
const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000;

/** Same "agent says this is travel/admin" gate as process_deals.py. */
const NOT_TRADE_TOKENS = [
  "hotel", "agoda", "airline", "e-ticket", "eticket", "flight", "expo booth",
  "plant renewal", "personal travel", "not freight", "not a freight", "membership",
  "appa", "interzoo", "admin ledger", "global ledger",
];

export type SyncResult = {
  connection_id: string;
  email: string;
  skipped?: "paused" | "locked";
  listed?: number;
  fresh?: number;
  ingested?: number;
  noise?: number;
  errors?: number;
  remaining?: number;
  deals_touched?: number;
  /** Deal keys that got new mail this run (mail-driven warnings are refreshed for these). */
  touched_keys?: string[];
  error?: string;
};

export type JobsResult = {
  finalized: number;
  started: number;
  skipped: number;
  failed: number;
  error?: string;
  /** Deals whose worker finished this run (their documents are read next). */
  finalizedKeys?: string[];
};

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export function toPublicConnection(
  row: MailConnectionRow,
  stats?: MailConnectionStats,
): MailConnectionPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secret_enc: _secret, cursor_json, ...rest } = row;
  const cursor = cursor_json || {};
  return {
    ...rest,
    synced_through: cursor.synced_through || null,
    stats,
  };
}

function backfillDays(conn: MailConnectionRow) {
  const raw = Number(conn.settings_json?.backfill_days ?? MAIL_LIMITS.defaultBackfillDays);
  return Math.min(Math.max(Number.isFinite(raw) ? raw : 30, 1), MAIL_LIMITS.maxBackfillDays);
}

function classifyContext(conns: MailConnectionRow[]): ClassifyContext {
  return { ownEmails: conns.map((c) => c.email) };
}

function messageRow(
  conn: MailConnectionRow,
  providerId: string,
  fields: Partial<StoredMailMessage>,
): StoredMailMessage {
  return {
    connection_id: conn.id,
    provider_message_id: providerId,
    internet_message_id: null,
    in_reply_to: null,
    references_json: [],
    deal_key: null,
    subject: null,
    from_email: null,
    from_name: null,
    to_text: null,
    cc_text: null,
    sent_at: null,
    body_text: null,
    attachments_json: [],
    status: "noise",
    role: null,
    ...fields,
  };
}

/**
 * Pull new mail for one connection: list → dedupe → fetch raw → parse →
 * noise filter → thread into a deal_key → store attachments → mark deals dirty.
 */
export async function syncConnection(
  id: string,
  opts: { deadline: number; store?: MailStore; all?: MailConnectionRow[] },
): Promise<SyncResult> {
  const store = opts.store || getMailStore();
  const conn = await store.getConnection(id);
  if (!conn) throw new Error(`Unknown connection ${id}`);
  const base: SyncResult = { connection_id: conn.id, email: conn.email };
  if (conn.status === "paused") return { ...base, skipped: "paused" };
  if (!(await store.acquireLock(conn.id, 90))) return { ...base, skipped: "locked" };

  const startedAt = new Date();
  const ctx = classifyContext(opts.all || (await store.listConnections()));
  let session: ProviderSession | null = null;
  const stats = { listed: 0, fresh: 0, ingested: 0, noise: 0, errors: 0, remaining: 0 };
  const touched = new Set<string>();
  let warning: string | null = null;

  try {
    session = await PROVIDER_SESSIONS[conn.provider](conn, decryptSecret(conn.secret_enc));

    const cursor = conn.cursor_json || {};
    const floor = startedAt.getTime() - backfillDays(conn) * DAY_MS;
    const since = cursor.synced_through
      ? Math.max(floor, Date.parse(cursor.synced_through) - MAIL_LIMITS.overlapMs)
      : floor;

    const refs = await session.listSince(new Date(since), MAIL_LIMITS.listCap);
    stats.listed = refs.length;
    if (refs.length >= MAIL_LIMITS.listCap) {
      warning = `More than ${MAIL_LIMITS.listCap} messages in the sync window — lower the backfill days to cover older mail`;
    }
    const known = new Set(await store.knownMessageIds(conn.id, refs.map((r) => r.id)));
    // Newest first: a freshly connected mailbox fills the shared inbox from the
    // top while older mail keeps backfilling on later runs.
    const fresh = refs.filter((r) => !known.has(r.id)).reverse();
    stats.fresh = fresh.length;

    const batch = fresh.slice(0, MAIL_LIMITS.messagesPerRun);
    const threadMap = new Map<string, string>();
    let pending: StoredMailMessage[] = [];
    const payments: PaymentRow[] = [];
    let handled = 0;

    const flush = async () => {
      if (payments.length && paymentReaderId()) {
        await queueNewPayments(store, payments.splice(0)).catch((err) => console.warn("[payments] queue failed", err));
      }
      if (!pending.length) return;
      await store.insertMessages(pending);
      pending = [];
    };

    for (const ref of batch) {
      if (Date.now() > opts.deadline) break;
      handled += 1;
      try {
        const raw = await session.fetchRaw(ref);
        if (!raw) {
          pending.push(messageRow(conn, ref.id, { status: "noise", subject: "(skipped by provider)" }));
          stats.noise += 1;
          continue;
        }
        if (raw.length > MAIL_LIMITS.rawMaxBytes) {
          pending.push(messageRow(conn, ref.id, { status: "error", subject: "(message too large)" }));
          stats.errors += 1;
          continue;
        }
        const mail = await parseRawMail(raw);
        const common: Partial<StoredMailMessage> = {
          thread_key: threadKeyFor(mail.subject, mail.internet_message_id || ref.id),
          folder: folderForRef(ref.id),
          internet_message_id: mail.internet_message_id,
          in_reply_to: mail.in_reply_to,
          references_json: mail.references.slice(-20),
          subject: mail.subject,
          from_email: mail.from_email,
          from_name: mail.from_name,
          to_text: mail.to_text.slice(0, 2000),
          cc_text: mail.cc_text.slice(0, 2000),
          sent_at: mail.sent_at,
          role: partyRole(mail.from_email, ctx),
        };

        if (isNoiseMessage(mail, ctx)) {
          // Not a deal, but still mail: keep the text so the shared inbox shows it.
          // Bank statements keep their attachment: payment reconciliation reads them.
          const keepFiles = isBankStatementMail(mail.from_email, mail.subject);
          const files: StoredAttachment[] = [];
          for (const a of mail.attachments) {
            if (!keepFiles) {
              files.push({ ...a.meta, skipped: "not_trade" });
              continue;
            }
            const stored = await storeAttachment(a.meta, a.content).catch(() => ({ ...a.meta, skipped: "upload_failed" }));
            files.push(stored);
            await ensureDocText(stored, a.content).catch(() => null);
          }
          pending.push(
            messageRow(conn, ref.id, {
              ...common,
              status: "noise",
              body_text: mail.body_text,
              attachments_json: files,
            }),
          );
          stats.noise += 1;
          continue;
        }

        // Thread: inherit the deal of any message this one replies to.
        const parents = [mail.in_reply_to, ...[...mail.references].reverse()].filter(
          (p): p is string => Boolean(p),
        );
        let dealKey = parents.map((p) => threadMap.get(p)).find(Boolean) || null;
        if (!dealKey && parents.length) {
          const found = await store.dealKeysForMessageIds(parents);
          dealKey = parents.map((p) => found[p]).find(Boolean) || null;
        }
        if (!dealKey) {
          dealKey = dealKeyFor(mail.subject, mail.internet_message_id || ref.id);
        }

        const paymentMail = isPaymentCandidate(
          mail.subject,
          freshText(mail.body_text, mail.subject),
          mail.attachments.map((a) => a.meta.name),
        );
        const attachments: StoredAttachment[] = [];
        for (const att of mail.attachments) {
          try {
            const image =
              /\.(jpe?g|png|gif|tiff?|webp)$/i.test(att.meta.name) ||
              (att.meta.content_type || "").startsWith("image/");
            const keepInline = Boolean(
              att.meta.inline && paymentMail && image && att.meta.size >= PAYMENT_IMAGE_MIN_BYTES,
            );
            const stored = await storeAttachment(att.meta, att.content, { allowInline: keepInline });
            attachments.push(stored);
            // Document layer: text for PDFs, sheets and Word files, cached by content (read once);
            // scans and photographed documents go to OCR (collected on a later cycle).
            const text = await ensureDocText(stored, att.content).catch((err) => {
              console.warn("[docs] text failed", stored.name, err);
              return null;
            });
            if (ocrEnabled() && (wantsOcr(stored, text) || (paymentMail && wantsPaymentImageOcr(stored)))) {
              await startOcr(stored).catch((err) => console.warn("[ocr] not started", stored.name, err instanceof Error ? err.message : err));
            }
          } catch (err) {
            attachments.push({
              ...att.meta,
              skipped: `upload_failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
            });
          }
        }

        const stored = messageRow(conn, ref.id, {
          ...common,
          deal_key: dealKey,
          body_text: mail.body_text,
          attachments_json: attachments,
          status: "ingested",
        });
        pending.push(stored);
        // Payment emails go to the ledger; the Payment Reader reads them on this or a later cycle.
        const payment = paymentRowFor(stored, conn.email);
        if (payment) payments.push(payment);
        if (mail.internet_message_id) threadMap.set(mail.internet_message_id, dealKey);
        touched.add(dealKey);
        stats.ingested += 1;
      } catch (err) {
        if (err instanceof MailAuthError) throw err;
        stats.errors += 1;
        pending.push(
          messageRow(conn, ref.id, {
            status: "error",
            subject: `(sync error) ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
          }),
        );
      }
      if (pending.length >= 20) await flush();
    }
    await flush();
    await store.markJobsDirty([...touched]);

    stats.remaining = fresh.length - handled;
    const latest = await store.getConnection(conn.id);
    const next: MailConnectionRow = {
      ...(latest || conn),
      status: "active",
      last_sync_at: new Date().toISOString(),
      last_error: warning,
      cursor_json: {
        ...((latest || conn).cursor_json || {}),
        synced_through:
          stats.remaining === 0 ? startedAt.toISOString() : cursor.synced_through,
      },
    };
    await store.saveConnection(next);
    return { ...base, ...stats, deals_touched: touched.size, touched_keys: [...touched] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const latest = (await store.getConnection(conn.id).catch(() => null)) || conn;
    await store
      .saveConnection({
        ...latest,
        status: err instanceof MailAuthError ? "reauth_required" : "error",
        last_error: message.slice(0, 500),
        last_sync_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    // Messages already stored still deserve processing.
    await store.markJobsDirty([...touched]).catch(() => undefined);
    return { ...base, ...stats, deals_touched: touched.size, touched_keys: [...touched], error: message };
  } finally {
    await session?.close().catch(() => undefined);
    await store.releaseLock(conn.id).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Deal jobs → Vibrium workers → processed_deals                       */
/* ------------------------------------------------------------------ */


type JobPack = {
  row: Omit<ProcessedDealUpsert, "status" | "execution_id" | "result_json" | "summary" | "confidence" | "error" | "cost_usd" | "input_tokens" | "output_tokens" | "processed_at">;
  /** Existing completed book row — never downgrade it to failed/skipped. */
  had_completed: boolean;
};

function summaryFrom(result: Record<string, unknown> | null) {
  const summary = typeof result?.summary === "string" ? result.summary : null;
  const conf = Number(result?.confidence);
  return { summary, confidence: Number.isFinite(conf) ? conf : null };
}

function rowSkeleton(
  pack: DealPack,
  slot: string,
  agentId: string,
  evidence: unknown,
  doc: { name: string } | null,
  documentUrl: string | null,
): JobPack["row"] {
  return {
    id: pack.id,
    po_numbers: pack.po_numbers,
    subject: pack.subject,
    primary_stage: pack.primary_stage,
    slot,
    agent_id: agentId,
    date_start: pack.date_start,
    date_end: pack.date_end,
    message_count: pack.message_count,
    doc_count: pack.doc_count,
    parties_json: pack.parties,
    commercial_model: pack.commercial_model,
    evidence_json: evidence,
    document_name: doc?.name || null,
    document_url: documentUrl,
  };
}

/** Keep an existing completed deal's result, but show the new mail in its evidence. */
async function refreshExistingEvidence(
  store: MailStore,
  existing: ProcessedDealRow,
  skeleton: JobPack["row"],
) {
  await store.upsertProcessedDeal({
    ...skeleton,
    slot: existing.slot ?? skeleton.slot,
    agent_id: existing.agent_id ?? skeleton.agent_id,
    primary_stage: existing.primary_stage ?? skeleton.primary_stage,
    document_name: existing.document_name ?? skeleton.document_name,
    document_url: existing.document_url ?? skeleton.document_url,
    execution_id: null,
    status: existing.status || "completed",
    summary: existing.summary ?? null,
    confidence: existing.confidence ?? null,
    result_json: existing.result_json ?? null,
    error: existing.error ?? null,
    processed_at: existing.processed_at || new Date().toISOString(),
    cost_usd: existing.cost_usd ?? null,
    input_tokens: null,
    output_tokens: null,
  });
}

function workerPayload(
  slot: string,
  pack: DealPack,
  context: string,
  email: string,
  documentUrl: string | null,
): Record<string, unknown> {
  if (DOC_REQUIRED.has(slot)) {
    const payload: Record<string, unknown> = {
      document_url: documentUrl,
      notes: `${context}\n\n${email.slice(0, 7000)}`.slice(0, 9000),
    };
    if (slot === "inspection_photo_summarizer" && pack.po_numbers[0]) {
      payload.po_number = pack.po_numbers[0];
    }
    return payload;
  }
  if (DOC_OPTIONAL.has(slot)) {
    const payload: Record<string, unknown> = {
      email_text: `${context}\n\n${email}`.slice(0, EMAIL_CHAR_LIMIT),
      notes: context.slice(0, 2000),
    };
    if (documentUrl) payload.document_url = documentUrl;
    return payload;
  }
  if (slot === "requirement_extractor") {
    return {
      email_text: `${context}\n\n${email}`.slice(0, EMAIL_CHAR_LIMIT),
      agency_context: context.slice(0, 2000),
    };
  }
  const payload: Record<string, unknown> = {
    email_text: `${context}\n\n${email}`.slice(0, EMAIL_CHAR_LIMIT),
  };
  if (["payment_clock", "commission_checklist", "sample_request_summarizer", "production_status_extractor"].includes(slot)) {
    payload.notes = context.slice(0, 2000);
  }
  return payload;
}

async function startJob(
  store: MailStore,
  job: MailDealJob,
  ctx: ClassifyContext,
  modes: Map<string, MailFilterMode>,
): Promise<"started" | "skipped"> {
  const key = job.deal_key;
  const live = await store.messagesForDeal(key, 80);
  if (!live.length) {
    await store.updateJob(key, { status: "skipped", last_error: "no_live_messages" });
    return "skipped";
  }
  const existing = await store.getProcessedDeal(key);
  const pack = buildDealPack(key, live, existing, ctx);
  const hadCompleted = existing?.status === "completed";

  const mode: MailFilterMode = live.some((m) => modes.get(m.connection_id) === "all") ? "all" : "trade";
  const relevance = hadCompleted
    ? { relevant: true, reason: "existing_deal" }
    : isRelevantDeal(
        {
          dealKey: key,
          subject: pack.subjects.join(" "),
          bodies: pack.messages.slice(0, 5).map((m) => m.body.slice(0, 800)).join(" "),
          stage: pack.primary_stage,
          roles: pack.roles,
          messageCount: pack.message_count,
          docCount: pack.documents.length,
          poNumbers: pack.po_numbers,
          documentNames: pack.documents.map((d) => d.name),
        },
        mode,
      );
  if (!relevance.relevant) {
    await store.updateJob(key, { status: "skipped", last_error: `not_relevant: ${relevance.reason}` });
    return "skipped";
  }

  const slot = chooseSlot(pack.primary_stage, pack.subjects, pack.documents);
  const agentId = agentIdForSlot(slot);
  const doc = pickDocument(pack.primary_stage, slot, pack.documents);
  const context = dealContextNotes(pack);
  const email = pack.agent_email_text;
  const documentUrl =
    doc && (DOC_REQUIRED.has(slot) || DOC_OPTIONAL.has(slot)) ? await presign(doc.s3_key) : null;
  const evidence = buildEvidence(pack, {
    slot,
    emailText: email,
    documentName: doc?.name || null,
    documentUrl,
  });
  const skeleton = rowSkeleton(pack, slot, agentId, evidence, doc, documentUrl);

  const skip = async (reason: string) => {
    if (existing) {
      await refreshExistingEvidence(store, existing, skeleton);
    } else {
      await store.upsertProcessedDeal({
        ...skeleton,
        execution_id: null,
        status: "skipped",
        summary: null,
        confidence: null,
        result_json: null,
        error: reason,
        processed_at: new Date().toISOString(),
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
      });
    }
    await store.updateJob(key, { status: "skipped", slot, agent_id: agentId, last_error: reason });
    return "skipped" as const;
  };

  if (!agentId) return skip(`no agent id for ${slot}`);
  if (DOC_REQUIRED.has(slot) && !documentUrl) return skip("missing_document_for_doc_worker");

  const executionId = await startExecution(
    agentId,
    workerPayload(slot, pack, context, email, documentUrl),
  );
  const jobPack: JobPack = { row: skeleton, had_completed: hadCompleted };
  await store.updateJob(key, {
    status: "running",
    execution_id: executionId,
    agent_id: agentId,
    slot,
    pack_json: jobPack as unknown as Record<string, unknown>,
    attempts: (job.attempts || 0) + 1,
    last_error: null,
    started_at: new Date().toISOString(),
  });
  return "started";
}

/** Failed runs are retried on later syncs until MAX_ATTEMPTS runs in a row have failed. */
const MAX_ATTEMPTS = 3;
function retryable(job: MailDealJob) {
  return (job.attempts || 0) < MAX_ATTEMPTS;
}

async function finalizeJob(
  store: MailStore,
  job: MailDealJob,
): Promise<"done" | "failed" | "skipped" | "waiting"> {
  const key = job.deal_key;
  const pack = job.pack_json as unknown as JobPack | null;
  if (!job.execution_id || !pack?.row) {
    await store.updateJob(key, { status: "failed", dirty: true, last_error: "lost execution state" });
    return "failed";
  }
  const ex = await getExecution(job.execution_id);
  const status = ex.status || "unknown";
  if (!TERMINAL.has(status)) {
    const started = job.started_at ? Date.parse(job.started_at) : Date.now();
    if (Date.now() - started < EXECUTION_TIMEOUT_MS) return "waiting";
    await store.updateJob(key, {
      status: "failed",
      last_error: `execution ${job.execution_id} timed out`,
      ...(retryable(job) ? { dirty: true } : {}),
    });
    return "failed";
  }

  const result = executionResult(ex);
  const { summary, confidence } = summaryFrom(result);
  const agentStage = stageForSlot(job.slot);
  const storedResult = result && agentStage ? { ...result, agent_stage: agentStage } : result;
  const cost = executionCost(ex);
  let rowStatus = status;
  let error: string | null =
    status === "completed" ? null : JSON.stringify(ex.error || ex.message || status).slice(0, 1000);

  if (result && result.isTradeDeal === false) {
    const reason = String(result.rejectReason || summary || "").toLowerCase();
    if (NOT_TRADE_TOKENS.some((t) => reason.includes(t))) {
      rowStatus = "skipped";
      error = `not_a_trade_deal: ${result.rejectReason || summary || "agent rejected"}`;
    }
  }

  if (rowStatus !== "completed" && pack.had_completed) {
    // Don't knock a good deal out of the book because one re-run failed.
    const existing = await store.getProcessedDeal(key);
    if (existing) await refreshExistingEvidence(store, existing, pack.row);
  } else {
    await store.upsertProcessedDeal({
      ...pack.row,
      primary_stage:
        rowStatus === "completed"
          ? preferredStage(pack.row.primary_stage || "other", {
              slot: job.slot,
              stage: agentStage,
              confidence,
            })
          : pack.row.primary_stage,
      execution_id: job.execution_id,
      status: rowStatus,
      summary,
      confidence,
      result_json: storedResult,
      error,
      processed_at: new Date().toISOString(),
      cost_usd: cost.usd,
      input_tokens: cost.inputTokens,
      output_tokens: cost.outputTokens,
    });
  }

  const jobStatus = rowStatus === "completed" ? "done" : rowStatus === "skipped" ? "skipped" : "failed";
  await store.updateJob(key, {
    status: jobStatus,
    pack_json: null,
    last_error: error,
    // A failed re-read kept the old extract; queue it again so new mail is not left out for good.
    ...(jobStatus === "failed" && retryable(job) ? { dirty: true } : {}),
    // attempts counts failures in a row; a good run starts the count again.
    ...(jobStatus === "done" ? { attempts: 0 } : {}),
  });
  return jobStatus;
}

export async function processJobs(opts: {
  deadline: number;
  store?: MailStore;
  all?: MailConnectionRow[];
}): Promise<JobsResult> {
  const store = opts.store || getMailStore();
  const out: JobsResult = { finalized: 0, started: 0, skipped: 0, failed: 0 };
  try {
    for (const job of await store.runningJobs(50)) {
      if (Date.now() > opts.deadline) break;
      try {
        const r = await finalizeJob(store, job);
        if (r === "done") {
          out.finalized += 1;
          (out.finalizedKeys ||= []).push(job.deal_key);
        }
        else if (r === "failed") out.failed += 1;
        else if (r === "skipped") out.skipped += 1;
      } catch (err) {
        out.failed += 1;
        await store
          .updateJob(job.deal_key, { last_error: err instanceof Error ? err.message : String(err) })
          .catch(() => undefined);
      }
    }

    if (Date.now() > opts.deadline) return out;
    const conns = opts.all || (await store.listConnections());
    const ctx = classifyContext(conns);
    const modes = new Map(conns.map((c) => [c.id, c.settings_json?.filter_mode || "trade"] as const));
    const claimed = await store.claimJobs(MAIL_LIMITS.jobsPerRun);
    for (const job of claimed) {
      if (Date.now() > opts.deadline) {
        // Hand back unstarted claims for the next run.
        await store.updateJob(job.deal_key, { status: "pending", dirty: true });
        continue;
      }
      try {
        const r = await startJob(store, job, ctx, modes);
        if (r === "started") out.started += 1;
        else out.skipped += 1;
      } catch (err) {
        out.failed += 1;
        await store.updateJob(job.deal_key, {
          status: "failed",
          dirty: (job.attempts || 0) < 3,
          attempts: (job.attempts || 0) + 1,
          last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        });
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One cycle: sync connections, then drive deal jobs                   */
/* ------------------------------------------------------------------ */

export async function runMailCycle(opts: {
  deadline: number;
  connectionId?: string;
  syncMail?: boolean;
  /** Skip inboxes synced within this window (auto-sync from open tabs). */
  minIntervalMs?: number;
}) {
  const store = getMailStore();
  const all = await store.listConnections();
  // Sender roles learned from the deal book (rebuilt at most daily); static lists still apply without it.
  await ensureLearnedRoles({ ownEmails: all.map((c) => c.email), rebuild: true });
  const targets = all.filter(
    (c) =>
      (opts.connectionId ? c.id === opts.connectionId : true) &&
      (c.status === "active" || c.status === "error"),
  );
  // Leave time at the end to start / finalize worker executions.
  const syncDeadline = opts.deadline - Math.min(12_000, (opts.deadline - Date.now()) * 0.3);
  const connections: SyncResult[] = [];
  if (opts.syncMail !== false) {
    for (const conn of targets) {
      if (Date.now() > syncDeadline) break;
      const fresh =
        opts.minIntervalMs &&
        conn.last_sync_at &&
        Date.now() - new Date(conn.last_sync_at).getTime() < opts.minIntervalMs;
      if (fresh) continue;
      connections.push(await syncConnection(conn.id, { deadline: syncDeadline, store, all }));
    }
  }
  const jobs = await processJobs({ deadline: opts.deadline, store, all });
  const documents = await runDocumentStep(opts.deadline, jobs.finalizedKeys || []);
  const ocr = ocrEnabled()
    ? await processOcr({ deadline: opts.deadline }).catch((err) => {
        console.warn("[ocr] round failed", err instanceof Error ? err.message : err);
        return null;
      })
    : null;
  const payments = await processPayments(store, { deadline: opts.deadline }).catch((err) => {
    console.warn("[payments] round failed", err);
    return null;
  });
  // Mail-driven warnings: re-read open items on deals with new mail or a payment email just read.
  const signalKeys = [...connections.flatMap((c) => c.touched_keys || []), ...(payments?.dealKeys || [])];
  const signals = signalKeys.length
    ? await refreshSignals(signalKeys, store).catch((err) => {
        console.warn("[signals] refresh failed", err instanceof Error ? err.message : err);
        return null;
      })
    : null;
  // Next action per deal: queue deals with new mail, run the agent, close actions our side has carried out.
  const nextActions = await runNextActionStep(store, signalKeys, opts.deadline);
  // Bank statements: trade lines matched to payment emails, POs and commission invoices (fails soft).
  const statements = await processStatements(store, { deadline: opts.deadline }).catch((err) => {
    console.warn("[statements] round failed", err instanceof Error ? err.message : err);
    return null;
  });
  // The key lists are internal; the cycle's response keeps the counts only.
  const connectionsOut = connections.map((c) => ({ ...c, touched_keys: undefined }));
  return { connections: connectionsOut, jobs, documents, ocr, payments, signals, nextActions, statements, job_counts: await store.jobCounts() };
}

async function runNextActionStep(store: MailStore, touchedKeys: string[], deadline: number) {
  try {
    const queued = await queueNextActions(store, touchedKeys);
    const ran = Date.now() < deadline ? await processNextActions(store, { deadline }) : { finished: 0, started: 0, failed: 0 };
    const taken = touchedKeys.length ? await markTakenFromMail(store, touchedKeys) : 0;
    return { queued, ...ran, taken };
  } catch (err) {
    console.warn("[next-action] step failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Collect finished per-document reads, then (MAIL_DOCUMENT_EXTRACTION=on) read
 * every PI / PO / invoice on the deals whose worker just finished.
 */
async function runDocumentStep(deadline: number, finalizedKeys: string[]) {
  if (!isRdsProxyEnabled() || Date.now() > deadline) return null;
  try {
    const finalized = await finalizeDealDocuments({ deadline });
    if (!documentExtractionEnabled() || !finalizedKeys.length || Date.now() > deadline) {
      return { ...finalized, started: 0 };
    }
    const plan = await planDealDocuments(finalizedKeys.slice(0, 10));
    const started = await startDealDocuments(plan.toRead, { deadline, limit: 10 });
    return { ...finalized, ...started, missing: plan.skipped.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
