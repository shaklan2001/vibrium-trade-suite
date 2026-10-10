import { NextRequest, NextResponse } from "next/server";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const BUCKET =
  process.env.AWS_S3_BUCKET || "conversation-agents-artifacts";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest")
  .replace(/^\/+|\/+$/g, "");

const DIGEST_RE = /^[a-f0-9]{64}$/i;

let client: S3Client | null = null;
function s3() {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

/**
 * Open a PST-ingest attachment uploaded under trade/pst-ingest/{sha256}/…
 * GET /api/ingest-files?digest=<sha256>&name=<optional filename hint>
 */
export async function GET(request: NextRequest) {
  const digest = (request.nextUrl.searchParams.get("digest") || "").toLowerCase();
  const nameHint = request.nextUrl.searchParams.get("name") || "";
  if (!DIGEST_RE.test(digest)) {
    return NextResponse.json({ error: "Invalid digest" }, { status: 400 });
  }

  try {
    const prefix = `${PREFIX}/${digest}/`;
    const listed = await s3().send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        MaxKeys: 20,
      }),
    );
    const objects = (listed.Contents || []).filter((o) => o.Key && !o.Key.endsWith("/"));
    if (!objects.length) {
      // Prefer a readable page when the link is opened in a browser tab.
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/html")) {
        return new NextResponse(
          `<!doctype html><meta charset="utf-8"/><title>Attachment missing</title>
           <body style="font:14px/1.45 system-ui;padding:2rem;max-width:40rem">
           <h1>Attachment not in cloud storage</h1>
           <p>This file was referenced in a mailbox deal but has not been uploaded to the ingest bucket yet.</p>
           <p><code>${digest}</code></p>
           </body>`,
          {
            status: 404,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      return NextResponse.json(
        { error: "Attachment not found in ingest bucket", digest },
        { status: 404 },
      );
    }

    let chosen = objects[0]!;
    if (nameHint) {
      const needle = nameHint.toLowerCase();
      const hit = objects.find((o) =>
        (o.Key || "").toLowerCase().endsWith(`/${needle}`),
      );
      if (hit) chosen = hit;
    }

    const key = chosen.Key!;
    const url = await getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 60 * 30 },
    );
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "S3 lookup failed",
      },
      { status: 500 },
    );
  }
}
