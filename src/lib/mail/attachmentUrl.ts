import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { attachmentBucket } from "./parse";

/** Workers fetch attachments by URL; a week is longer than any run. */
const PRESIGN_SECONDS = 7 * 24 * 3600;

let s3: S3Client | null = null;

/** Presigned GET for a stored mail attachment (S3 key from attachments_json). */
export async function presign(key: string) {
  if (!s3) s3 = new S3Client({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1" });
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: attachmentBucket(), Key: key }), {
    expiresIn: PRESIGN_SECONDS,
  });
}
