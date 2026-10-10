"use client";

import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { sampleOpenUrl } from "@/lib/trade/sampleFiles";
import { digestFromIngestPath, ingestFileOpenUrl } from "@/lib/trade/ingestFiles";

/** Open link for a vault / source sample artefact. */
export function OpenableFileLink({
  name,
  samplePath,
  url,
  className = "",
}: {
  name: string;
  samplePath?: string;
  url?: string;
  className?: string;
}) {
  const href =
    url ||
    ingestFileOpenUrl({ path: samplePath, name, url }) ||
    (samplePath && !digestFromIngestPath(samplePath)
      ? sampleOpenUrl(samplePath)
      : undefined);
  if (!href) {
    return <span className={`${className} text-zinc-600`}>{name}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 text-teal-700 underline decoration-teal-600/40 underline-offset-2 hover:text-teal-900 ${className}`}
      title="Open source file"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
    </a>
  );
}

export function AttachmentChip({
  name,
  samplePath,
  url,
  extractedBy,
  extractedSummary,
}: {
  name: string;
  samplePath?: string;
  url?: string;
  extractedBy?: string;
  extractedSummary?: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs">
      <div className="flex items-start gap-2">
        <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <OpenableFileLink name={name} samplePath={samplePath} url={url} />
          {extractedBy ? (
            <div className="mt-1 text-[11px] text-zinc-500">
              Agent: <span className="font-medium text-zinc-700">{extractedBy}</span>
              {extractedSummary ? (
                <span className="text-zinc-500"> — {extractedSummary}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
