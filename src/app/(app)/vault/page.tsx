"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Card } from "@/components/ui/primitives";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { dealLabel } from "@/lib/trade/dealCode";
import { OpenableFileLink } from "@/components/ops/openable-file-link";

export default function VaultPage() {
  const deals = useVisibleDeals();
  const [dealId, setDealId] = useState("");
  const docs = useMemo(
    () =>
      deals
        .filter((d) => !dealId || d.id === dealId)
        .flatMap((d) =>
          d.documents.map((doc) => ({
            ...doc,
            dealTitle: d.title,
            dealCode: d.code,
          })),
        ),
    [deals, dealId],
  );

  return (
    <div>
      <PageHeader
        title="Document Vault"
        description="Source files on deals — open the original artefact the agent extracted from."
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
              {dealLabel(d)}
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
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={5}>
                  No documents yet. Open Command Center and refresh data to sync the vault
                  or upload from Quotes / Pipeline.
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} className="border-b border-zinc-50">
                  <td className="px-3 py-2">
                    <OpenableFileLink
                      name={d.name}
                      samplePath={d.samplePath}
                      url={d.url}
                    />
                    {d.extractedSummary ? (
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {d.extractedSummary}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{d.type}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{d.dealCode}</span>
                    <span className="text-zinc-500"> · {d.dealTitle}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600">
                    {d.extractedBy || d.s3Key || "—"}
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
