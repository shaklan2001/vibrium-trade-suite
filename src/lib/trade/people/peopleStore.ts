/**
 * The people index (people.ts) built from the live data and kept warm:
 *
 *   mail       every deal's stored mail history (processed_deals evidence: from / to / cc / date),
 *              read once and kept in S3 at {PREFIX}/_people/messages.v1.json (rebuilt on request or
 *              when older than REBUILD_AFTER_MS), plus the newest synced mail from each connected
 *              mailbox, read live so "who wrote last" is current
 *   edits      personas (mail_records kind "persona") and owner pins (kind "deal_owner")
 *
 * getPeopleIndex() returns the computed index (cached a few minutes in process), or null when no mail
 * history has been read yet — callers then fall back to what they did before. Server only; fails soft.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { attachmentBucket } from "@/lib/mail/parse";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { computePeopleIndex, emailsIn, namesIn, type OwnerPins, type PeopleIndex, type PeopleMessage, type PersonaEdit } from "./people";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");
const KEY = `${PREFIX}/_people/messages.v1.json`;
export const REBUILD_AFTER_MS = 12 * 60 * 60 * 1000;
const CACHE_MS = 5 * 60 * 1000;
const CONCURRENCY = 20;

let s3: S3Client | null = null;
const client = () => (s3 ||= new S3Client({ region: REGION }));

type MessagesFile = { builtAt: string; deals: number; messages: PeopleMessage[] };

let fileCache: { at: number; file: MessagesFile | null } | null = null;
let indexCache: { at: number; index: PeopleIndex } | null = null;
let building: Promise<MessagesFile & { fetched: number }> | null = null;

async function readFile(): Promise<MessagesFile | null> {
  if (fileCache && Date.now() - fileCache.at < CACHE_MS) return fileCache.file;
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: KEY }));
    const file = JSON.parse(Buffer.from(await res.Body!.transformToByteArray()).toString("utf8")) as MessagesFile;
    fileCache = { at: Date.now(), file };
    return file;
  } catch {
    fileCache = { at: Date.now(), file: null };
    return null;
  }
}

const list = (v: unknown): string[] => (Array.isArray(v) ? emailsIn(v.join(", ")) : emailsIn(typeof v === "string" ? v : ""));
const text = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");

/** One evidence / mail message → what the index needs. */
function toMessage(dealKey: string, m: Record<string, unknown>, i: number): PeopleMessage | null {
  const at = String(m.date || m.sent_at || m.received_at || "");
  const from = emailsIn(String(m.from || m.from_email || ""))[0] || null;
  if (!at || !from) return null;
  return {
    id: String(m.id || m.internet_message_id || m.message_id || `${dealKey}#${i}`).toLowerCase(),
    dealKey,
    at,
    from,
    fromName: typeof m.from_name === "string" ? m.from_name : null,
    to: list(m.to ?? m.to_text),
    cc: list(m.cc ?? m.cc_text),
    names: { ...namesIn(text(m.to ?? m.to_text)), ...namesIn(text(m.cc ?? m.cc_text)) },
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/**
 * Read the deals' mail history (headers only) and save it. Incremental: a deal not updated since the
 * last read keeps the messages read then, so only new / changed deals are fetched (a full read of
 * ~2,000 deals takes about a minute; `full` forces it).
 */
export async function rebuildPeopleMessages(opts: { full?: boolean } = {}): Promise<MessagesFile & { fetched: number }> {
  if (building) return building;
  building = (async () => {
    const store = getMailStore();
    const book = await getCopilotBook({ force: true });
    const prev = opts.full ? null : await readFile();
    const since = prev ? Date.parse(prev.builtAt) - 60 * 60 * 1000 : 0;
    const prevByDeal = new Map<string, PeopleMessage[]>();
    for (const m of prev?.messages || []) (prevByDeal.get(m.dealKey) || prevByDeal.set(m.dealKey, []).get(m.dealKey)!).push(m);
    const updated = new Map(book.deals.filter((d) => d.mailboxSourceId).map((d) => [d.mailboxSourceId!, Date.parse(d.updatedAt) || 0]));
    const keys = [...updated.keys()];
    const toFetch = keys.filter((k) => !prevByDeal.has(k) || (updated.get(k) || 0) >= since);
    const kept = keys.filter((k) => !toFetch.includes(k)).flatMap((k) => prevByDeal.get(k) || []);
    const perDeal = await pool(toFetch, CONCURRENCY, async (key) => {
      try {
        const row = await store.getProcessedDeal(key);
        const ev = (row?.evidence_json || {}) as { messages?: Record<string, unknown>[] };
        return (ev.messages || []).map((m, i) => toMessage(key, m, i)).filter((m): m is PeopleMessage => Boolean(m));
      } catch {
        return [];
      }
    });
    const file: MessagesFile = { builtAt: new Date().toISOString(), deals: keys.length, messages: [...kept, ...perDeal.flat()] };
    await client().send(new PutObjectCommand({ Bucket: attachmentBucket(), Key: KEY, Body: JSON.stringify(file), ContentType: "application/json" }));
    fileCache = { at: Date.now(), file };
    indexCache = null;
    return { ...file, fetched: toFetch.length };
  })();
  try {
    return await building;
  } finally {
    building = null;
  }
}

/** Newest synced mail from every connected mailbox (the history file is hours old). */
async function liveMessages(): Promise<PeopleMessage[]> {
  const store = getMailStore();
  const conns = await store.listConnections().catch(() => []);
  const rows = (await Promise.all(conns.map((c) => store.recentMessages({ connectionId: c.id, limit: 200 }).catch(() => [])))).flat();
  return rows
    .filter((m) => m.deal_key)
    .map((m, i) =>
      toMessage(
        m.deal_key!,
        { id: m.internet_message_id || m.provider_message_id, date: m.sent_at, from: m.from_email, from_name: m.from_name, to: m.to_text, cc: m.cc_text },
        i,
      ),
    )
    .filter((m): m is PeopleMessage => Boolean(m));
}

export async function loadPersonaEdits(): Promise<PersonaEdit[]> {
  const rows = await getMailStore().listRecords({ kind: "persona", limit: 500 });
  return rows.map((r) => ({ ...(r.data as PersonaEdit), id: r.id }));
}

export async function loadOwnerPins(): Promise<OwnerPins> {
  const rows = await getMailStore().listRecords({ kind: "deal_owner", limit: 5000 });
  return Object.fromEntries(rows.map((r) => [r.id, typeof r.data.personId === "string" ? r.data.personId : null]));
}

/** The index, or null when no mail history has been read yet. */
export async function getPeopleIndex(opts: { fresh?: boolean } = {}): Promise<(PeopleIndex & { historyBuiltAt: string; stale: boolean }) | null> {
  if (!mailStoreConfigured()) return null;
  try {
    const file = await readFile();
    if (!file) return null;
    if (!opts.fresh && indexCache && Date.now() - indexCache.at < CACHE_MS) {
      return { ...indexCache.index, historyBuiltAt: file.builtAt, stale: Date.now() - Date.parse(file.builtAt) > REBUILD_AFTER_MS };
    }
    const [live, edits, pins] = await Promise.all([liveMessages().catch(() => []), loadPersonaEdits().catch(() => []), loadOwnerPins().catch(() => ({}))]);
    // Only deals in the book count (live mail can belong to a thread not processed into a deal yet).
    const book = await getCopilotBook();
    const keys = new Set(book.deals.map((d) => d.mailboxSourceId).filter(Boolean));
    const index = computePeopleIndex([...file.messages, ...live].filter((m) => keys.has(m.dealKey)), edits, pins);
    indexCache = { at: Date.now(), index };
    return { ...index, historyBuiltAt: file.builtAt, stale: Date.now() - Date.parse(file.builtAt) > REBUILD_AFTER_MS };
  } catch (err) {
    console.warn("[people] index unavailable", err instanceof Error ? err.message : err);
    return null;
  }
}

export function invalidatePeopleIndex(): void {
  indexCache = null;
}

export async function savePersona(edit: PersonaEdit): Promise<void> {
  await getMailStore().upsertRecords([{ kind: "persona", id: edit.id, dealKey: null, data: edit as unknown as Record<string, unknown> }]);
  invalidatePeopleIndex();
}

export async function pinOwner(dealKey: string, personId: string | null, by: string): Promise<void> {
  await getMailStore().upsertRecords([
    { kind: "deal_owner", id: dealKey, dealKey, data: { personId, by, at: new Date().toISOString() } },
  ]);
  invalidatePeopleIndex();
}
