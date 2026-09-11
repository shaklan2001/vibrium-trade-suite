/** Openable trade artefacts under docs/samples. */

const SAMPLES_PREFIX = "docs/samples/";

export function samplePublicPath(samplePath: string): string {
  return sampleApiUrl(samplePath);
}

/** Served by /api/samples so artefacts ship with the function (Vercel tracing). */
export function sampleOpenUrl(samplePath: string): string {
  return sampleApiUrl(samplePath);
}

export function sampleApiUrl(samplePath: string): string {
  const rel = samplePath.startsWith(SAMPLES_PREFIX)
    ? samplePath.slice(SAMPLES_PREFIX.length)
    : samplePath.replace(/^\/*/, "");
  return `/api/samples/${rel
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
}

export function mimeForSample(nameOrPath: string): string {
  const lower = nameOrPath.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

export function fileNameFromSamplePath(samplePath: string): string {
  const parts = samplePath.split("/");
  return parts[parts.length - 1] || samplePath;
}
