import { NextRequest, NextResponse } from "next/server";
import { readFile, access } from "fs/promises";
import path from "path";
import { constants } from "fs";
import { mimeForSample } from "@/lib/trade/sampleFiles";

export const runtime = "nodejs";

const ROOT = path.join(process.cwd(), "docs", "samples");

async function resolveSafe(segments: string[]): Promise<string | null> {
  if (!segments.length) return null;
  const decoded = segments.map((s) => decodeURIComponent(s));
  if (decoded.some((s) => s === ".." || s.includes("\0"))) return null;
  const abs = path.resolve(ROOT, ...decoded);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  try {
    await access(abs, constants.R_OK);
    return abs;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await ctx.params;
  const abs = await resolveSafe(segments || []);
  if (!abs) {
    return NextResponse.json({ error: "Sample not found" }, { status: 404 });
  }

  const buf = await readFile(abs);
  const name = path.basename(abs);
  const mime = mimeForSample(name);
  const inline =
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime.startsWith("text/");

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
