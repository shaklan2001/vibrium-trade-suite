/**
 * Stores the mail-driven open items (mailSignals.ts) for every deal with live mail, in one small index:
 *
 *   {PREFIX}/_signals/index.v1.json   { updatedAt, deals: { [dealKey]: { computedAt, items } } }
 *
 * Refreshed for the deals a mail cycle touched (new mail, or a payment email just read) and by
 * scripts/backfill-mail-signals.ts. Read once by the app (GET /api/mail/signals). Server only.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { freshText } from "./inbox";
import { mailSignals, type MailSignal, type SignalMessage } from "./mailSignals";
import { attachmentBucket } from "./parse";
import { getMailStore, type MailStore } from "./store";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");
const INDEX_KEY = `${PREFIX}/_signals/index.v1.json`;
const OURS = /@snspl\.(in|ml)$/i;

export type SignalIndex = { updatedAt: string; deals: Record<string, { computedAt: string; items: MailSignal[] }> };

let s3: S3Client | null = null;
const client = () => (s3 ||= new S3Client({ region: REGION }));

export async function getSignalIndex(): Promise<SignalIndex> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: INDEX_KEY }));
    return JSON.parse(Buffer.from(await res.Body!.transformToByteArray()).toString("utf8")) as SignalIndex;
  } catch {
    return { updatedAt: "", deals: {} };
  }
}

/** Open items for one deal, from its live mail and its payment emails. */
export async function computeDealSignals(dealKey: string, store: MailStore = getMailStore(), ownEmails: string[] = []) {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const rows = await store.messagesForDeal(dealKey, 200);
  const seen = new Set<string>();
  const messages: SignalMessage[] = [];
  for (const m of rows) {
    const id = m.internet_message_id || m.provider_message_id;
    if (seen.has(id) || !m.sent_at) continue;
    seen.add(id);
    const from = (m.from_email || "").toLowerCase();
    messages.push({
      id,
      from,
      fromName: m.from_name || "",
      internal: OURS.test(from) || own.has(from),
      date: new Date(m.sent_at).toISOString(),
      subject: m.subject || "",
      body: freshText(m.body_text || "", m.subject || ""),
    });
  }
  const payments = (await store.listPayments({ status: "done", limit: 5000 }).catch(() => [])).filter((p) => p.dealKey === dealKey);
  return mailSignals(messages, payments);
}

/** Recompute and save open items for these deals (read-modify-write of the one index file). */
export async function refreshSignals(dealKeys: string[], store: MailStore = getMailStore()) {
  const keys = [...new Set(dealKeys.filter(Boolean))];
  if (!keys.length) return { refreshed: 0 };
  const own = (await store.listConnections().catch(() => [])).map((c) => c.email);
  const computed: SignalIndex["deals"] = {};
  for (const key of keys) {
    try {
      computed[key] = { computedAt: new Date().toISOString(), items: await computeDealSignals(key, store, own) };
    } catch (err) {
      console.warn("[signals] deal failed", key, err instanceof Error ? err.message : err);
    }
  }
  // Re-read right before writing, so another cycle's update in the meantime is kept.
  const index = await getSignalIndex();
  for (const [key, value] of Object.entries(computed)) {
    if (value.items.length) index.deals[key] = value;
    else delete index.deals[key];
  }
  index.updatedAt = new Date().toISOString();
  await client().send(
    new PutObjectCommand({ Bucket: attachmentBucket(), Key: INDEX_KEY, Body: JSON.stringify(index), ContentType: "application/json" }),
  );
  return { refreshed: Object.keys(computed).length };
}
