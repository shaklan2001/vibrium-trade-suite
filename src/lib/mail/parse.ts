import { createHash } from "crypto";
import path from "path";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MAIL_LIMITS } from "./config";
import type { StoredAttachment } from "./types";

export type NormalizedMail = {
  internet_message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  subject: string;
  from_email: string | null;
  from_name: string | null;
  to: string[];
  cc: string[];
  to_text: string;
  cc_text: string;
  sent_at: string | null;
  body_text: string;
  attachments: { meta: StoredAttachment; content: Buffer }[];
};

export function normalizeMsgId(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.trim().split(/\s+/)[0] || "";
  const clean = first.replace(/^[<"']+|[>"']+$/g, "").trim();
  return clean ? clean.toLowerCase() : null;
}

function addresses(obj: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(obj) ? obj : obj ? [obj] : [];
  const out: { email: string; name: string }[] = [];
  for (const group of list) {
    for (const v of group.value || []) {
      if (v.address) out.push({ email: v.address.toLowerCase(), name: v.name || "" });
      for (const inner of v.group || []) {
        if (inner.address) out.push({ email: inner.address.toLowerCase(), name: inner.name || "" });
      }
    }
  }
  return out;
}

function fmt(list: { email: string; name: string }[]) {
  return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
}

/** Minimal HTML → text for mail that has no text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function bodyText(parsed: ParsedMail): string {
  const text = parsed.text?.trim()
    ? parsed.text
    : typeof parsed.html === "string"
      ? htmlToText(parsed.html)
      : "";
  if (text.length <= MAIL_LIMITS.bodyChars) return text;
  return `${text.slice(0, MAIL_LIMITS.bodyChars)}\n\n[truncated]`;
}

export function safeFilename(name: string): string {
  const base = path.basename(name) || "document";
  const cleaned = base.replace(/[^A-Za-z0-9.\-_]/g, "_").slice(0, 120);
  return cleaned.replace(/^\.+/, "") || "document";
}

export async function parseRawMail(raw: Buffer | string): Promise<NormalizedMail> {
  const parsed = await simpleParser(raw, {
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });
  const from = addresses(parsed.from)[0];
  const to = addresses(parsed.to);
  const cc = addresses(parsed.cc);
  const refsRaw = parsed.references;
  const references = (Array.isArray(refsRaw) ? refsRaw : refsRaw ? refsRaw.split(/\s+/) : [])
    .map((r) => normalizeMsgId(r))
    .filter((r): r is string => Boolean(r));

  const attachments: NormalizedMail["attachments"] = [];
  for (const att of parsed.attachments || []) {
    const content = att.content as Buffer;
    if (!content || !Buffer.isBuffer(content)) continue;
    const name = att.filename || `attachment${att.contentType ? `.${att.contentType.split("/")[1]}` : ""}`;
    const ext = path.extname(name).toLowerCase();
    const inline =
      att.contentDisposition === "inline" || Boolean(att.related) || Boolean(att.cid && !att.filename);
    attachments.push({
      content,
      meta: {
        name,
        ext,
        size: content.length,
        content_type: att.contentType || "application/octet-stream",
        sha256: createHash("sha256").update(content).digest("hex"),
        inline,
      },
    });
  }

  return {
    internet_message_id: normalizeMsgId(parsed.messageId),
    in_reply_to: normalizeMsgId(
      Array.isArray(parsed.inReplyTo) ? parsed.inReplyTo[0] : parsed.inReplyTo,
    ),
    references,
    subject: parsed.subject || "",
    from_email: from?.email || null,
    from_name: from?.name || null,
    to: to.map((a) => a.email),
    cc: cc.map((a) => a.email),
    to_text: fmt(to),
    cc_text: fmt(cc),
    sent_at: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    body_text: bodyText(parsed),
    attachments,
  };
}

/* ------------------------------------------------------------------ */
/* Attachment upload — same content store as PST ingest                */
/* ------------------------------------------------------------------ */

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const BUCKET = process.env.AWS_S3_BUCKET || "conversation-agents-artifacts";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");

let s3: S3Client | null = null;
function client() {
  if (!s3) s3 = new S3Client({ region: REGION });
  return s3;
}

export function attachmentStoreConfigured() {
  return Boolean(BUCKET);
}

/**
 * Upload to {prefix}/{sha256}/{file} so /api/ingest-files?digest=… can open it.
 * Content-addressed: a file seen in two mailboxes is stored once.
 */
export async function storeAttachment(
  meta: StoredAttachment,
  content: Buffer,
): Promise<StoredAttachment> {
  if (meta.inline) return { ...meta, skipped: "inline" };
  if (meta.size > MAIL_LIMITS.attachmentMaxBytes) return { ...meta, skipped: "too_large" };
  if (!BUCKET) return { ...meta, skipped: "no_bucket" };
  const key = `${PREFIX}/${meta.sha256}/${safeFilename(meta.name)}`;
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    await client().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: content,
        ContentType: meta.content_type,
      }),
    );
  }
  return { ...meta, s3_key: key };
}

export function attachmentBucket() {
  return BUCKET;
}
