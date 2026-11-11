/**
 * Read every PI / PO / invoice on a deal, not just the one file the deal's main
 * worker read. Each attachment gets its own PI or PO extractor run; results go
 * to trade_suite.deal_documents and the Deal Board adds them up per side
 * (processedDealMapper → applyCommercialDocs).
 *
 * Server only (S3 + Vibrium + RDS proxy). Used by:
 *   - POST /api/processed-deals/documents (backfill, dry run by default)
 *   - the mail cycle (finalize running reads; read new deals when
 *     MAIL_DOCUMENT_EXTRACTION=on)
 */
import path from "path";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { agentIdForSlot } from "@/lib/mail/classify";
import {
  executionCost,
  executionResult,
  getExecution,
  startExecution,
  TERMINAL,
} from "@/lib/mail/workers";
import { invokeTradeSuiteRds } from "@/lib/rdsProxy";
import { digestFromIngestPath } from "./ingestFiles";
import { isCommercialFile, PO_FILE_RE } from "./documentSide";
import type { EvidencePayload, ProcessedDealRow } from "./processedDealMapper";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const BUCKET = process.env.AWS_S3_BUCKET || "conversation-agents-artifacts";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");
const READABLE_EXT = new Set([".pdf", ".xlsx", ".docx"]);
const PRESIGN_SECONDS = 7 * 24 * 3600;
const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000;
/** Rough gpt-4.1 cost of one PI/PO read, for dry-run estimates only. */
export const EST_USD_PER_DOCUMENT = 0.05;

export function documentExtractionEnabled() {
  return (process.env.MAIL_DOCUMENT_EXTRACTION || "").toLowerCase() === "on";
}

let s3: S3Client | null = null;
function client() {
  if (!s3) s3 = new S3Client({ region: REGION });
  return s3;
}

async function storedKey(sha256: string): Promise<string | null> {
  const res = await client().send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/${sha256}`, MaxKeys: 5 }),
  );
  return (res.Contents || []).find((o) => o.Key && !o.Key.endsWith("/"))?.Key || null;
}

async function rds<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await invokeTradeSuiteRds<T>(payload);
  if (!res.success) throw new Error(res.error || `${String(payload.action)} failed`);
  return res.data as T;
}

type DocRow = {
  deal_id: string;
  sha256: string;
  name?: string | null;
  sent_at?: string | null;
  slot?: string | null;
  agent_id?: string | null;
  execution_id?: string | null;
  status: string;
  result_json?: Record<string, unknown> | null;
  error?: string | null;
  cost_usd?: number | null;
  started_at?: string | null;
};

export type PlannedDocument = {
  dealId: string;
  sha256: string;
  name: string;
  sentAt: string | null;
  slot: "pi_extractor" | "po_extractor";
  s3Key: string;
};

export type SkippedDocument = { dealId: string; name: string; reason: string };

export type DocumentPlan = {
  deals: number;
  toRead: PlannedDocument[];
  skipped: SkippedDocument[];
  alreadyRead: number;
  estUsd: number;
};

function parseEvidence(row: ProcessedDealRow): EvidencePayload {
  const raw = row.evidence_json as unknown;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EvidencePayload;
    } catch {
      return {};
    }
  }
  return (raw as EvidencePayload) || {};
}

/** Which attachments on these deals still need a PI / PO read. */
export async function planDealDocuments(dealIds: string[]): Promise<DocumentPlan> {
  const plan: DocumentPlan = { deals: 0, toRead: [], skipped: [], alreadyRead: 0, estUsd: 0 };
  if (!dealIds.length) return plan;
  // Before the proxy with deal_documents is deployed, nothing has been read yet.
  const existing = await rds<DocRow[]>({ action: "list_deal_documents", deal_ids: dealIds }).catch(
    (err: Error) => {
      if (/Unknown action/i.test(err.message)) return [] as DocRow[];
      throw err;
    },
  );
  const known = new Set(
    existing.filter((d) => d.status !== "failed").map((d) => `${d.deal_id}|${d.sha256}`),
  );

  for (const dealId of dealIds) {
    const row = await rds<ProcessedDealRow>({ action: "get_evidence", id: dealId }).catch(() => null);
    if (!row) continue;
    plan.deals += 1;
    const evidence = parseEvidence(row);
    // The main worker already read this one.
    const mainRead =
      row.slot === "pi_extractor" || row.slot === "po_extractor"
        ? evidence.document_name || row.document_name
        : null;
    const seen = new Set<string>();
    for (const m of evidence.messages || []) {
      for (const a of m.attachments || []) {
        const name = a.name || "";
        const sha256 = digestFromIngestPath(a.path) || "";
        if (!name || !sha256 || seen.has(sha256)) continue;
        seen.add(sha256);
        if (!isCommercialFile(name)) continue;
        if (name === mainRead) continue;
        if (known.has(`${dealId}|${sha256}`)) {
          plan.alreadyRead += 1;
          continue;
        }
        const ext = path.extname(name).toLowerCase();
        if (!READABLE_EXT.has(ext)) {
          plan.skipped.push({ dealId, name, reason: `${ext || "no extension"} is not readable by the extractor` });
          continue;
        }
        const s3Key = await storedKey(sha256);
        if (!s3Key) {
          plan.skipped.push({ dealId, name, reason: "file was never uploaded" });
          continue;
        }
        plan.toRead.push({
          dealId,
          sha256,
          name,
          sentAt: m.date || null,
          slot: PO_FILE_RE.test(name) && !/pro\s*-?\s*forma|performa/i.test(name) ? "po_extractor" : "pi_extractor",
          s3Key,
        });
      }
    }
  }
  plan.estUsd = Math.round(plan.toRead.length * EST_USD_PER_DOCUMENT * 100) / 100;
  return plan;
}

function notesFor(doc: PlannedDocument, row?: ProcessedDealRow | null) {
  return [
    `File: ${doc.name}`,
    `Deal: ${doc.dealId}`,
    row?.commercial_model ? `commercial_model: ${row.commercial_model}` : "",
    row?.po_numbers?.length ? `po_numbers: ${row.po_numbers.join(", ")}` : "",
    "This file may be a proforma invoice, a purchase order or a commercial invoice.",
    "Read only this file. docNumber is this document's own number. shipper/factory = the seller",
    "who issued or supplies it; buyer/consignee = who it is addressed to. totalAmount and currency",
    "exactly as written on the document (do not convert).",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Start one PI / PO extractor run per planned document. */
export async function startDealDocuments(
  docs: PlannedDocument[],
  opts: { deadline: number; limit?: number },
): Promise<{ started: number; failed: number }> {
  const out = { started: 0, failed: 0 };
  for (const doc of docs.slice(0, opts.limit ?? docs.length)) {
    if (Date.now() > opts.deadline) break;
    const agentId = agentIdForSlot(doc.slot);
    const base = {
      deal_id: doc.dealId,
      sha256: doc.sha256,
      name: doc.name,
      sent_at: doc.sentAt,
      slot: doc.slot,
      agent_id: agentId,
    };
    try {
      const url = await getSignedUrl(
        client(),
        new GetObjectCommand({ Bucket: BUCKET, Key: doc.s3Key }),
        { expiresIn: PRESIGN_SECONDS },
      );
      const executionId = await startExecution(agentId, {
        document_url: url,
        notes: notesFor(doc).slice(0, 9000),
      });
      await rds({
        action: "upsert_deal_document",
        row: { ...base, execution_id: executionId, status: "running", started_at: new Date().toISOString() },
      });
      out.started += 1;
    } catch (err) {
      out.failed += 1;
      await rds({
        action: "upsert_deal_document",
        row: { ...base, status: "failed", error: String(err instanceof Error ? err.message : err).slice(0, 500) },
      }).catch(() => undefined);
    }
  }
  return out;
}

/** Collect finished runs into deal_documents. */
export async function finalizeDealDocuments(opts: {
  deadline: number;
}): Promise<{ completed: number; failed: number; waiting: number }> {
  const out = { completed: 0, failed: 0, waiting: 0 };
  const running = await rds<DocRow[]>({ action: "list_deal_documents", status: "running", limit: 200 });
  for (const doc of running) {
    if (Date.now() > opts.deadline) break;
    if (!doc.execution_id) continue;
    try {
      const ex = await getExecution(doc.execution_id);
      const status = ex.status || "unknown";
      if (!TERMINAL.has(status)) {
        const started = doc.started_at ? Date.parse(doc.started_at) : Date.now();
        if (Date.now() - started < EXECUTION_TIMEOUT_MS) {
          out.waiting += 1;
          continue;
        }
      }
      const result = executionResult(ex);
      const ok = status === "completed" && result != null;
      await rds({
        action: "upsert_deal_document",
        row: {
          ...doc,
          status: ok ? "completed" : "failed",
          result_json: result,
          error: ok ? null : JSON.stringify(ex.error || ex.message || status).slice(0, 500),
          cost_usd: executionCost(ex).usd,
        },
      });
      if (ok) out.completed += 1;
      else out.failed += 1;
    } catch (err) {
      out.failed += 1;
      console.error("finalizeDealDocuments", doc.deal_id, doc.name, err);
    }
  }
  return out;
}
