/**
 * Large statement uploads, in parts. Vercel refuses a request body over 4.5 MB before the route runs
 * (a 10-page scanned statement is ~10 MB), so the browser sends the file in parts of under 4 MB;
 * each part is parked in S3 under {prefix}/_statement-uploads/{uploadId}/{index}, and the read
 * request puts them back together and deletes them.
 * Server only.
 */
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { attachmentBucket } from "./parse";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");

/** Below Vercel's 4.5 MB body limit, with room for the multipart envelope. */
export const UPLOAD_PART_BYTES = 3_500_000;
export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_STATEMENT_BYTES / UPLOAD_PART_BYTES);

const UPLOAD_ID = /^[a-f0-9-]{36}$/i;

let s3: S3Client | null = null;
const client = () => (s3 ||= new S3Client({ region: REGION }));
const partKey = (uploadId: string, index: number) => `${PREFIX}/_statement-uploads/${uploadId.toLowerCase()}/${index}`;

export function validUploadId(id: unknown): id is string {
  return typeof id === "string" && UPLOAD_ID.test(id);
}

export async function putUploadPart(uploadId: string, index: number, body: Buffer) {
  await client().send(new PutObjectCommand({ Bucket: attachmentBucket(), Key: partKey(uploadId, index), Body: body, ContentType: "application/octet-stream" }));
}

/** The parts, in order, as one file; the parts are deleted. Null when one is missing. */
export async function takeUploadParts(uploadId: string, parts: number): Promise<Buffer | null> {
  const bufs: Buffer[] = [];
  try {
    for (let i = 0; i < parts; i++) {
      const res = await client().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: partKey(uploadId, i) }));
      bufs.push(Buffer.from(await res.Body!.transformToByteArray()));
    }
  } catch {
    return null;
  } finally {
    await client()
      .send(
        new DeleteObjectsCommand({
          Bucket: attachmentBucket(),
          Delete: { Objects: Array.from({ length: parts }, (_, i) => ({ Key: partKey(uploadId, i) })), Quiet: true },
        }),
      )
      .catch(() => undefined);
  }
  return Buffer.concat(bufs);
}
