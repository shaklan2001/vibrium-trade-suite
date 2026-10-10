/** Resolve PST-ingest attachment paths (sha256 content store) to openable URLs. */

const DIGEST_RE = /(?:^|\/)([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i;

export function digestFromIngestPath(path?: string | null): string | undefined {
  if (!path) return undefined;
  const m = path.trim().match(DIGEST_RE);
  return m?.[1]?.toLowerCase();
}

/** App route that redirects to a short-lived S3 GET URL. */
export function ingestFileOpenUrl(opts: {
  path?: string | null;
  name?: string | null;
  url?: string | null;
}): string | undefined {
  if (opts.url) return opts.url;
  const digest = digestFromIngestPath(opts.path);
  if (!digest) return undefined;
  const q = new URLSearchParams({ digest });
  if (opts.name) q.set("name", opts.name);
  return `/api/ingest-files?${q.toString()}`;
}
