"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Card } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { PaginationBar } from "@/components/ui/pagination";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { dealOptions } from "@/lib/trade/dealCode";
import { OpenableFileLink } from "@/components/ops/openable-file-link";

const PAGE_SIZE = 50;

const TYPE_TONE: Record<string, "info" | "success" | "warning" | "neutral"> = {
  commercial_invoice: "info",
  invoice: "info",
  packing_list: "info",
  bill_of_lading: "info",
  quote: "success",
  purchase_order: "warning",
  proforma_invoice: "warning",
};

const ACRONYMS = new Set(["po", "pi", "bl", "ci", "pl", "coo", "awb", "hbl", "mbl", "si", "fx", "qc"]);

function humanize(value: string) {
  const words = value.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return value;
  return words
    .map((w, i) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : i === 0
          ? w.charAt(0).toUpperCase() + w.slice(1)
          : w,
    )
    .join(" ");
}

function compactWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso || "—", time: "" };
  return {
    date: d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function VaultPage() {
  const deals = useVisibleDeals();
  const [dealId, setDealId] = useState("");
  const [page, setPage] = useState(1);

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

  const options = useMemo(
    () => [{ value: "", label: "All deals" }, ...dealOptions(deals)],
    [deals],
  );

  const pages = Math.max(1, Math.ceil(docs.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const rows = docs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="min-w-0">
      <PageHeader
        title="Document Vault"
        description="Source files on deals — open the original artefact the agent extracted from."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-[26rem]">
          <Select
            aria-label="Filter documents by deal"
            value={dealId}
            onChange={(v) => {
              setDealId(v);
              setPage(1);
            }}
            options={options}
            searchPlaceholder="Search deal code or summary…"
            menuWidth={560}
          />
        </div>
        <span className="text-xs text-[var(--muted)] tabular-nums">
          {docs.length.toLocaleString()} document{docs.length === 1 ? "" : "s"}
        </span>
      </div>
      <Card className="overflow-hidden">
        <div className="vault-table-scroll">
          <table className="vault-table">
            <colgroup>
              <col className="vault-col-name" />
              <col className="vault-col-type" />
              <col className="vault-col-deal" />
              <col className="vault-col-agent" />
              <col className="vault-col-when" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Deal</th>
                <th scope="col">Agent</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="vault-empty" colSpan={5}>
                    No documents yet. Open Command Center and refresh data to sync the
                    vault or upload from Quotes / Pipeline.
                  </td>
                </tr>
              ) : (
                rows.map((d) => {
                  const when = compactWhen(d.uploadedAt);
                  const agent = d.extractedBy || d.s3Key || "";
                  return (
                    <tr key={d.id}>
                      <td>
                        <div className="vault-name">
                          <OpenableFileLink
                            name={d.name}
                            samplePath={d.samplePath}
                            url={d.url}
                            className="max-w-full font-medium"
                          />
                        </div>
                        {d.extractedSummary ? (
                          <p className="vault-clamp" title={d.extractedSummary}>
                            {d.extractedSummary}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={TYPE_TONE[d.type] ?? "neutral"}>
                          <span className="vault-badge-text" title={d.type}>
                            {humanize(d.type)}
                          </span>
                        </Badge>
                      </td>
                      <td>
                        {d.dealCode ? (
                          <span className="deal-code-chip" title={d.dealCode}>
                            {d.dealCode}
                          </span>
                        ) : null}
                        <p className="vault-clamp" title={d.dealTitle}>
                          {d.dealTitle}
                        </p>
                      </td>
                      <td>
                        <span className="vault-agent" title={agent || undefined}>
                          {agent ? humanize(agent) : "—"}
                        </span>
                      </td>
                      <td className="vault-when">
                        <time dateTime={d.uploadedAt} title={d.uploadedAt}>
                          {when.date}
                        </time>
                        {when.time ? <span>{when.time}</span> : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {docs.length > 0 ? (
        <PaginationBar
          page={safePage}
          pageSize={PAGE_SIZE}
          total={docs.length}
          onPageChange={(p) => {
            setPage(p);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : null}
    </div>
  );
}
