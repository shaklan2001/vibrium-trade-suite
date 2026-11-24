/**
 * Learned sender roles (learnedRoles.ts) kept in one S3 file, rebuilt at most once a day:
 *
 *   {PREFIX}/_roles/index.v1.json   { builtAt, roles: { "domain.com": "buyer" } }
 *
 * partyRole() reads the in-process copy (setLearnedRoles); ensureLearnedRoles() fills it.
 * Everything here fails soft: with no store or no bucket the static lists still apply. Server only.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { partyRole, setLearnedRoles } from "./classify";
import { learnRoles, type LearnedRoles, type RoleObservation } from "./learnedRoles";
import { attachmentBucket } from "./parse";
import { getMailStore, type MailStore } from "./store";
import type { StoredAttachment } from "./types";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");
const KEY = `${PREFIX}/_roles/index.v1.json`;
const REBUILD_AFTER_MS = 24 * 60 * 60 * 1000;
const MESSAGES_SCANNED = 6000;

type RolesFile = { builtAt: string; roles: LearnedRoles };

let s3: S3Client | null = null;
const client = () => (s3 ||= new S3Client({ region: REGION }));
let loadedAt = 0;

async function readFile(): Promise<RolesFile | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: KEY }));
    return JSON.parse(Buffer.from(await res.Body!.transformToByteArray()).toString("utf8")) as RolesFile;
  } catch {
    return null;
  }
}

/** Learn from the newest mail across every connected mailbox and save the result. */
export async function rebuildLearnedRoles(store: MailStore = getMailStore(), ownEmails: string[] = []): Promise<RolesFile> {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const rows = await store.recentMessages({ limit: MESSAGES_SCANNED });
  const observations: RoleObservation[] = [];
  for (const m of rows) {
    if (!m.deal_key || !m.from_email) continue;
    const files = ((m.attachments_json || []) as StoredAttachment[]).filter((a) => !a.inline).map((a) => a.name);
    observations.push({
      dealKey: m.deal_key,
      from: m.from_email,
      subject: m.subject || "",
      files,
      internal: own.has(m.from_email.toLowerCase()),
    });
  }
  // Domains the static lists already place are not learned again.
  const roles = learnRoles(observations, (email) => {
    const role = partyRole(email, { ownEmails });
    return role !== "other";
  });
  const file: RolesFile = { builtAt: new Date().toISOString(), roles };
  await client().send(new PutObjectCommand({ Bucket: attachmentBucket(), Key: KEY, Body: JSON.stringify(file), ContentType: "application/json" }));
  return file;
}

/** Load (and, when a day old, rebuild) the learned roles into classify.ts. Never throws. */
export async function ensureLearnedRoles(opts: { ownEmails?: string[]; rebuild?: boolean } = {}): Promise<number> {
  if (Date.now() - loadedAt < 10 * 60 * 1000) return 0;
  loadedAt = Date.now();
  try {
    let file = await readFile();
    const stale = !file || Date.now() - Date.parse(file.builtAt) > REBUILD_AFTER_MS;
    if (stale && opts.rebuild) file = await rebuildLearnedRoles(getMailStore(), opts.ownEmails || []);
    setLearnedRoles(file?.roles || {});
    return Object.keys(file?.roles || {}).length;
  } catch (err) {
    console.warn("[roles] not loaded", err instanceof Error ? err.message : err);
    return 0;
  }
}
