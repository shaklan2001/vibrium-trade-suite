"use client";

import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { friendlyMailboxError } from "@/lib/trade/mailboxHydrate";
import type { EarlyWarning } from "@/lib/trade/earlyWarnings";
import type { MailboxBookStatus } from "@/lib/trade/store";

export function EarlyWarningBody({
  rows,
  status,
  error,
  moreHref,
}: {
  rows: EarlyWarning[];
  status: MailboxBookStatus;
  error: string | null;
  moreHref?: string | null;
}) {
  const loading = status === "idle" || status === "loading";
  const failed = status === "error";

  return (
    <div className="divide-y divide-zinc-100">
      {failed && error ? (
        <p className="px-4 py-2 text-sm text-red-700" role="alert">
          {friendlyMailboxError(error)}
        </p>
      ) : null}
      {loading && rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-500">Checking the book…</p>
      ) : null}
      {rows.map((row) => (
        <Link
          key={row.id}
          href={row.href}
          className="block px-4 py-2.5 hover:bg-zinc-50"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={row.severity === "critical" ? "danger" : "warning"}>
              {row.title}
            </Badge>
            {row.dealCode ? (
              <span className="font-mono text-[11px] text-zinc-500">
                {row.dealCode}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-zinc-800">{row.reason}</p>
        </Link>
      ))}
      {!loading && !failed && rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-500">No open warnings.</p>
      ) : null}
      {moreHref ? (
        <Link
          href={moreHref}
          className="block px-4 py-2 text-xs text-teal-700 underline"
        >
          All warnings
        </Link>
      ) : null}
    </div>
  );
}

export function EarlyWarningsCard({
  rows,
  status,
  error,
}: {
  rows: EarlyWarning[];
  status: MailboxBookStatus;
  error: string | null;
}) {
  return (
    <Card className="mb-4">
      <CardHeader
        title="Early warnings"
        description="PO at risk, delivery at risk, or action needed"
      />
      <div className="max-h-80 overflow-auto">
        <EarlyWarningBody rows={rows} status={status} error={error} />
      </div>
    </Card>
  );
}
