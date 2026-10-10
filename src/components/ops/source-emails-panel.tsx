"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import type { SourceMessage, SourceMessageKind } from "@/types/trade";
import { AttachmentChip } from "@/components/ops/openable-file-link";

const KIND_LABEL: Record<SourceMessageKind, string> = {
  requirement: "Buyer enquiry",
  quote: "Factory quote",
  artwork: "Artwork",
  samples: "Samples",
  pi: "Proforma",
  po: "Purchase order",
  packaging: "Packaging",
  production: "Production",
  inspection: "Inspection",
  booking: "Booking",
  payment: "Payment",
  commission: "Commission",
  other: "Message",
};

export function SourceEmailsPanel({
  sources,
  kinds,
  title = "Source evidence",
  compact = false,
}: {
  sources: SourceMessage[];
  /** If set, only show these kinds (still show empty state when none) */
  kinds?: SourceMessageKind[];
  title?: string;
  compact?: boolean;
}) {
  const list = kinds
    ? sources.filter((s) => kinds.includes(s.kind))
    : sources;
  const [openId, setOpenId] = useState<string | null>(list[0]?.id || null);
  const fileCount = list.reduce(
    (n, s) => n + (s.attachments?.length || 0),
    0,
  );

  if (list.length === 0) {
    return (
      <Card>
        <CardHeader
          title={title}
          description="No source message attached yet"
        />
        <p className="px-4 py-3 text-sm text-zinc-500">
          When you extract from an email or upload a quote pack, the original
          message and files are kept here for audit.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={title}
        description={`${list.length} message${list.length === 1 ? "" : "s"}${
          fileCount ? ` · ${fileCount} openable file${fileCount === 1 ? "" : "s"}` : ""
        }`}
      />
      <div className={compact ? "max-h-80 overflow-auto" : ""}>
        <ul className="divide-y divide-zinc-100">
          {list.map((s) => {
            const open = openId === s.id;
            return (
              <li key={s.id} id={`source-${s.id}`} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{KIND_LABEL[s.kind]}</Badge>
                      <span className="text-sm font-medium text-zinc-900">
                        {s.label || s.subject || KIND_LABEL[s.kind]}
                      </span>
                      {(s.attachments?.length || 0) > 0 ? (
                        <Badge>{s.attachments!.length} file(s)</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {s.from ? <span>From {s.from}</span> : null}
                      {s.to ? (
                        <span>
                          {s.from ? " · " : ""}
                          To {s.to}
                        </span>
                      ) : null}
                      {s.cc ? (
                        <span>
                          {(s.from || s.to) ? " · " : ""}
                          Cc {s.cc}
                        </span>
                      ) : null}
                      {s.bcc ? (
                        <span>
                          {(s.from || s.to || s.cc) ? " · " : ""}
                          Bcc {s.bcc}
                        </span>
                      ) : null}
                      {s.receivedAt ? (
                        <span>
                          {s.from || s.to || s.cc || s.bcc ? " · " : ""}
                          {new Date(s.receivedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    {s.extractedBy || s.extractedSummary ? (
                      <p className="mt-1.5 text-xs text-zinc-600">
                        <span className="font-medium text-zinc-800">
                          Agent output
                          {s.extractedBy ? ` · ${s.extractedBy}` : ""}:
                        </span>{" "}
                        {s.extractedSummary || "Structured fields extracted from this source."}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-2 py-1 text-xs"
                    onClick={() => setOpenId(open ? null : s.id)}
                  >
                    {open ? "Hide" : "View source"}
                  </Button>
                </div>
                {open ? (
                  <div className="mt-3 space-y-3">
                    {(s.attachments?.length || 0) > 0 ? (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          Attached source files
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {s.attachments!.map((a, i) => (
                            <AttachmentChip
                              key={`${a.samplePath}-${i}`}
                              name={a.name}
                              samplePath={a.samplePath}
                              url={a.url}
                              extractedBy={a.extractedBy}
                              extractedSummary={a.extractedSummary}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <pre className="max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap">
                      {s.body}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
