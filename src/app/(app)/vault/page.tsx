"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Card } from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";

export default function VaultPage() {
  const deals = useTradeStore((s) => s.deals);
  const [dealId, setDealId] = useState("");
  const docs = useMemo(
    () =>
      deals
        .filter((d) => !dealId || d.id === dealId)
        .flatMap((d) =>
          d.documents.map((doc) => ({ ...doc, dealTitle: d.title })),
        ),
    [deals, dealId],
  );

  return (
    <div>
      <PageHeader
        title="Document Vault"
        description="Files uploaded to S3 via Vibrium presigned URLs, plus local deal attachments."
      />
      <div className="mb-4 max-w-sm">
        <select
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          value={dealId}
          onChange={(e) => setDealId(e.target.value)}
        >
          <option value="">All deals</option>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>
      <Card>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Deal</th>
              <th className="px-3 py-2">S3 key</th>
              <th className="px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={5}>
                  No documents yet.
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} className="border-b border-zinc-50">
                  <td className="px-3 py-2">
                    {d.url ? (
                      <a
                        href={d.url}
                        className="text-teal-700 underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {d.name}
                      </a>
                    ) : (
                      d.name
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{d.type}</Badge>
                  </td>
                  <td className="px-3 py-2">{d.dealTitle}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {d.s3Key || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {new Date(d.uploadedAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
