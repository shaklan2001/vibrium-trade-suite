"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Label,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { normalizeQuoteFromWorkerOutput } from "@/lib/trade/parsers";
import { getExecutionResult, runWorkerAndWait } from "@/services/agentsApi";
import { getPresignedUpload } from "@/services/channelsApi";
import { SourceEmailsPanel } from "@/components/ops/source-emails-panel";
import { dealOptions } from "@/lib/trade/dealCode";
import { Select } from "@/components/ui/select";

export default function QuotesPage() {
  const deals = useVisibleDeals();
  const setQuote = useTradeStore((s) => s.setQuote);
  const toggleSku = useTradeStore((s) => s.toggleSku);
  const lockSelection = useTradeStore((s) => s.lockSelection);
  const addDocument = useTradeStore((s) => s.addDocument);
  const addSource = useTradeStore((s) => s.addSource);
  const routing = useTradeStore((s) => s.routing);

  const [dealId, setDealId] = useState(deals[0]?.id || "");
  const deal = useMemo(
    () => deals.find((d) => d.id === dealId),
    [deals, dealId],
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const uploadBlocked = busy || !dealId || !routing.quote_normalizer;

  async function onUpload(file: File | null) {
    if (!file || !deal) {
      toast.error("Select a deal and file");
      return;
    }
    if (!routing.quote_normalizer) {
      toast.error(
        "Configure quote_normalizer in Agent Routing before uploading",
      );
      return;
    }

    setBusy(true);
    setStatus("Uploading…");
    try {
      const signed = await getPresignedUpload({
        filename: file.name,
        content_type:
          file.type ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        folder: "trade/quotes",
      });
      const uploadUrl = signed.upload_url || signed.url;
      if (!uploadUrl) throw new Error("Presign returned no upload URL");

      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type":
            file.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });

      const documentUrl = signed.public_url || "";
      if (!documentUrl) {
        throw new Error(
          "Upload succeeded but no public document_url — quote_normalizer cannot read the file",
        );
      }

      const s3Key = signed.s3_key || signed.key || "";
      addDocument(deal.id, {
        name: file.name,
        type: "quote",
        s3Key,
        url: documentUrl,
        extractedBy: "quote_normalizer",
      });
      addSource(deal.id, {
        kind: "quote",
        label: `Quote pack · ${file.name}`,
        subject: `AS / quote sheet — ${file.name}`,
        from: deal.quote?.factoryName || "Factory",
        body: `Quote / AS sheet received for deal ${deal.code} (${deal.title}).\n\nFile: ${file.name}\nStored for traceability with the normalized SKU matrix.\n\nCategory: ${deal.requirement?.productCategory || "—"}\nTarget factory cost: ${deal.requirement?.targetFactoryCost ?? "—"}`,
        relatedDocumentId: s3Key,
        extractedBy: "quote_normalizer",
        extractedSummary: `Normalized quote matrix from ${file.name}`,
        attachments: [
          {
            name: file.name,
            url: documentUrl,
            extractedBy: "quote_normalizer",
            extractedSummary: "Source AS / quote sheet",
          },
        ],
      });

      setStatus("Normalizing quote sheet…");
      const ex = await runWorkerAndWait(
        routing.quote_normalizer,
        {
          document_url: documentUrl,
          notes: `AS/quote sheet for ${deal.code}${
            deal.requirement?.productCategory
              ? ` · ${deal.requirement.productCategory}`
              : ""
          }`,
          ...(deal.requirement?.targetFactoryCost != null
            ? { target_factory_cost: deal.requirement.targetFactoryCost }
            : {}),
        },
        (e) => setStatus(`Status: ${e.status}`),
      );
      if (ex.status !== "completed") {
        throw new Error(ex.error || `Worker ${ex.status}`);
      }

      setQuote(
        deal.id,
        normalizeQuoteFromWorkerOutput(
          getExecutionResult(ex),
          ex.execution_id,
        ),
      );
      setStatus(`Done · ${ex.execution_id}`);
      toast.success("Quote matrix ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setStatus("Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Upload factory AS / quote sheets. Source messages stay attached to the deal for audit."
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Deal</Label>
            <Select
              aria-label="Deal"
              value={dealId}
              onChange={setDealId}
              placeholder="Select deal…"
              searchPlaceholder="Search deal code or summary…"
              options={dealOptions(deals)}
            />
          </div>
          <div>
            <Label>Quote sheet</Label>
            <label
              className={`dropzone ${uploadBlocked ? "is-disabled" : ""} ${dragOver ? "is-over" : ""}`}
              onDragOver={(e) => {
                if (uploadBlocked) return;
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!uploadBlocked) void onUpload(e.dataTransfer.files?.[0] || null);
              }}
            >
              <input
                type="file"
                className="sr-only"
                accept=".xlsx,.xls,.csv,.pdf"
                disabled={uploadBlocked}
                onChange={(e) => void onUpload(e.target.files?.[0] || null)}
              />
              <UploadCloud className="h-5 w-5" aria-hidden />
              <span className="dropzone-main">
                {busy ? "Reading the sheet…" : "Drop a quote sheet or choose a file"}
              </span>
              <span className="dropzone-sub">
                {!dealId
                  ? "Pick a deal first"
                  : !routing.quote_normalizer
                    ? "Set up the quote reader in Agent Routing first"
                    : "Excel, CSV or PDF"}
              </span>
            </label>
          </div>
        </div>
        {status ? <p className="mt-2 text-xs text-zinc-500">{status}</p> : null}
      </Card>

      {deal ? (
        <div className="mb-4">
          <SourceEmailsPanel
            sources={deal.sources || []}
            kinds={["requirement", "quote"]}
            title="Source evidence for this quote"
            compact
          />
        </div>
      ) : null}

      {deal?.quote ? (
        <Card>
          <CardHeader
            title={`Quote matrix · ${deal.quote.factoryName || "Factory"}`}
            description={`${deal.code} · ${deal.quote.skus.length} SKUs${
              deal.quote.incoterm ? ` · ${deal.quote.incoterm}` : ""
            }`}
            action={
              <Button
                disabled={deal.selectionLocked}
                onClick={() => {
                  lockSelection(deal.id);
                  toast.success("Selection locked");
                }}
              >
                Lock selection
              </Button>
            }
          />
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Select</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">MOQ</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Packing</th>
                </tr>
              </thead>
              <tbody>
                {deal.quote.skus.map((sku, i) => (
                  <tr key={i} className="border-b border-zinc-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(sku.selected)}
                        disabled={deal.selectionLocked}
                        onChange={(e) =>
                          toggleSku(deal.id, i, e.target.checked)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {sku.itemCode}
                    </td>
                    <td className="px-3 py-2">{sku.description}</td>
                    <td className="px-3 py-2">{sku.moq ?? "—"}</td>
                    <td className="px-3 py-2">
                      {sku.unitPrice != null
                        ? `${sku.currency || "USD"} ${sku.unitPrice}`
                        : "—"}
                      {sku.selected ? (
                        <Badge tone="success">selected</Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-600">
                      {sku.packingNotes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="quote-empty">
          <h2>Build a quote matrix</h2>
          <ol>
            <li>
              <b>Pick the deal</b> the factory is quoting for.
            </li>
            <li>
              <b>Drop the factory&apos;s quote sheet.</b> The agent reads each SKU,
              MOQ, price and packing note.
            </li>
            <li>
              <b>Tick the SKUs</b> the buyer wants, then lock the selection.
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}
