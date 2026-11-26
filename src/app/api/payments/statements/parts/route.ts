import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { MAX_UPLOAD_PARTS, putUploadPart, UPLOAD_PART_BYTES, validUploadId } from "@/lib/mail/statementUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/statements/parts   multipart: uploadId (uuid), index (0-based), part (≤ 3.5 MB)
 * One part of a statement too large for a single request. /api/payments/statements then reads the
 * file with { uploadId, parts, name } instead of { file }.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "statement-upload-part", 120, 60_000);
  if (limited) return limited;
  try {
    const form = await req.formData();
    const uploadId = form.get("uploadId");
    const index = Number(form.get("index"));
    const part = form.get("part");
    if (!validUploadId(uploadId)) return jsonError("Bad upload id", 400);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_UPLOAD_PARTS) return jsonError("Bad part number", 400);
    if (!(part instanceof File) || !part.size) return jsonError("Missing part", 400);
    if (part.size > UPLOAD_PART_BYTES + 1024) return jsonError("Part too large", 413);
    await putUploadPart(uploadId, index, Buffer.from(await part.arrayBuffer()));
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[payments/statements/parts] failed", err);
    return jsonError(err, 502);
  }
}
