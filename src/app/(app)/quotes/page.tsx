"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Label,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { normalizeQuoteFromWorkerOutput } from "@/lib/trade/parsers";
import { runWorkerAndWait } from "@/services/agentsApi";
import { getPresignedUpload } from "@/services/channelsApi";

export default function QuotesPage() {
  const deals = useTradeStore((s) => s.deals);
  const setQuote = useTradeStore((s) => s.setQuote);
  const toggleSku = useTradeStore((s) => s.toggleSku);
  const lockSelection = useTradeStore((s) => s.lockSelection);
  const addDocument = useTradeStore((s) => s.addDocument);
  const routing = useTradeStore((s) => s.routing);

  const [dealId, setDealId] = useState(deals[0]?.id || "");
  const deal = useMemo(
    () => deals.find((d) => d.id === dealId),
    [deals, dealId],
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function onUpload(file: File | null) {
    if (!file || !deal) {
      toast.error("Select a deal and file");
      return;
    }
    setBusy(true);
    setStatus("Uploading…");
    try {
      let documentUrl = "";
      let s3Key = "";

      try {
        const signed = await getPresignedUpload({
          filename: file.name,
          content_type:
            file.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          folder: "trade/quotes",
        });
        const uploadUrl = signed.upload_url || signed.url;
        if (uploadUrl) {
          await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type":
                file.type ||
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          });
        }
        documentUrl = signed.public_url || uploadUrl || "";
        s3Key = signed.s3_key || signed.key || "";
      } catch {
        // Fallback: object URL only works locally for worker if publicly reachable — use data note
        documentUrl = "";
        toast.message(
          "Presign unavailable — will try local sample matrix if no worker URL",
        );
      }

      addDocument(deal.id, {
        name: file.name,
        type: "quote",
        s3Key,
        url: documentUrl,
      });

      if (routing.quote_normalizer && documentUrl) {
        setStatus("Running quote_normalizer…");
        const ex = await runWorkerAndWait(
          routing.quote_normalizer,
          {
            document_url: documentUrl,
            notes: `AS/quote sheet for deal ${deal.id}`,
          },
          (e) => setStatus(`Worker: ${e.status}`),
        );
        if (ex.status !== "completed") {
          throw new Error(ex.error || `Worker ${ex.status}`);
        }
        setQuote(
          deal.id,
          normalizeQuoteFromWorkerOutput(ex.output, ex.execution_id),
        );
        toast.success("Quote matrix ready");
      } else {
        // Deterministic demo matrix from known leather toys fixture naming
        setQuote(deal.id, {
          factoryName: "Y.K. Industries",
          currency: "USD",
          executionId: undefined,
          skus: [
            {
              itemCode: "E26842",
              description: "13\" Durable Leather Raccoon Rope Toy",
              unitPrice: 0.85,
              moq: 500,
              currency: "USD",
              selected: false,
            },
            {
              itemCode: "E26843",
              description: "13\" Durable Leather Moose Rope Toy",
              unitPrice: 0.85,
              moq: 500,
              currency: "USD",
              selected: false,
            },
            {
              itemCode: "E26844",
              description: "13\" Durable Leather Bear Rope Toy",
              unitPrice: 0.85,
              moq: 500,
              currency: "USD",
              selected: false,
            },
            {
              itemCode: "E26845",
              description: "13\" Durable Leather Rabbit Rope Toy",
              unitPrice: 0.85,
              moq: 500,
              currency: "USD",
              selected: false,
            },
          ],
          raw: { mode: "fixture_fallback", file: file.name },
        });
        toast.message(
          routing.quote_normalizer
            ? "No public document URL — loaded fixture matrix"
            : "Configure quote_normalizer — loaded fixture matrix",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Upload factory AS/quote sheets. Normalize with the quote_normalizer worker, then select SKUs."
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Deal</Label>
            <select
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
            >
              <option value="">Select deal…</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>AS / quote Excel</Label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={busy || !dealId}
              onChange={(e) => void onUpload(e.target.files?.[0] || null)}
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Fixture available at docs/fixtures/AS LEATHER TOYS 6.3.25.xlsx
            </p>
          </div>
        </div>
        {status ? <p className="mt-2 text-xs text-zinc-500">{status}</p> : null}
      </Card>

      {deal?.quote ? (
        <Card>
          <CardHeader
            title={`Quote matrix · ${deal.quote.factoryName || "Factory"}`}
            description={`${deal.quote.skus.length} SKUs`}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center text-sm text-zinc-500">
          Upload a quote sheet to populate the matrix.
        </Card>
      )}
    </div>
  );
}
