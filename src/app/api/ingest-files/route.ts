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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

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
    let objects = (listed.Contents || []).filter(
      (o) => o.Key && !o.Key.endsWith("/"),
    );
    if (!objects.length) {
      // Fallback: object may live as trade/pst-ingest/{digest}.ext (no folder).
      const flat = await s3().send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: `${PREFIX}/${digest}`,
          MaxKeys: 20,
        }),
      );
      objects = (flat.Contents || []).filter(
        (o) => o.Key && !o.Key.endsWith("/"),
      );
    }

    if (!objects.length) {
      // Prefer a readable page when the link is opened in a browser tab.
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/html")) {
        return new NextResponse(
          `<!doctype html><meta charset="utf-8"/><title>Attachment missing</title>
           <body style="font:14px/1.45 system-ui;padding:2rem;max-width:40rem">
           <h1>${nameHint ? escapeHtml(nameHint) : "This attachment"} was never uploaded</h1>
           <p>The email that carried this file is in the deal, but the file itself is not in cloud storage. Most mailbox deals came from an Outlook (PST) export, and only one file per deal was uploaded from it.</p>
           <p>To fix it, upload the missing files from the original export: <code>python scripts/upload-missing-attachments.py</code> on the machine that holds <code>data/pst_extract</code>. Mail from a connected mailbox uploads its files automatically.</p>
           <p style="color:#71717a">File id <code>${digest}</code></p>
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
