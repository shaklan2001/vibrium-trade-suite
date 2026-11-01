/** Resolve PST-ingest attachment paths (sha256 content store) to openable URLs. */

const DIGEST_RE = /(?:^|\/)([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i;
const S3_DIGEST_RE = /\/trade\/pst-ingest\/([a-f0-9]{64})(?:\/|$)/i;

export function digestFromIngestPath(path?: string | null): string | undefined {
  if (!path) return undefined;
  const m = path.trim().match(DIGEST_RE);
  return m?.[1]?.toLowerCase();
}

/** Pull sha256 from a trade/pst-ingest S3 URL (incl. expired presigns). */
export function digestFromIngestUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const m = url.match(S3_DIGEST_RE);
  return m?.[1]?.toLowerCase();
}

/**
 * App route that redirects to a short-lived S3 GET URL.
 * Prefer digest-based opens over stored presigned URLs (those expire in ~7 days).
 */
export function ingestFileOpenUrl(opts: {
  path?: string | null;
  name?: string | null;
  url?: string | null;
}): string | undefined {
  const digest =
    digestFromIngestPath(opts.path) || digestFromIngestUrl(opts.url);
  if (digest) {
    const q = new URLSearchParams({ digest });
    if (opts.name) q.set("name", opts.name);
    return `/api/ingest-files?${q.toString()}`;
  }
  if (opts.url) return opts.url;
  return undefined;
}
