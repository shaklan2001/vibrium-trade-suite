"use client";

import { useRef, useState } from "react";
import { FileUp, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui/primitives";

type TradeLine = {
  date: string;
  kind: string;
  amount: number;
  currency: string;
  reference: string | null;
  email: { id: string; subject: string; how: string } | null;
  pos: string[];
  poHow: string | null;
  invoiceNo: string | null;
};

type Result = {
  ok: boolean;
  method: string;
  usedAgent: boolean;
  agentAvailable: boolean;
  currency: string;
  period: { from: string; to: string };
  lines: number;
  alreadyStored: number;
  tradeLines: number;
  stored: number;
  dropped: number;
  matchedToEmail: number;
  matchedToPo: number;
  skipped: number;
  trade: TradeLine[];
};

const KIND: Record<string, string> = {
  inward_remittance: "Inward remittance",
  trade_credit: "Credit from a trade party",
  trade_debit: "Payment to a trade party",
  commission: "Commission",
};

const money = (n: number, cur: string) => `${n < 0 ? "−" : "+"}${cur} ${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Upload a bank statement (PDF with text, Excel, CSV or HTML) and read it: trade lines are matched to
 * payment emails and POs and show as “Confirmed in bank” on the order. For banks that email an
 * encrypted HTML (HSBC), download the statement from the bank and upload that file here.
 */
export function StatementUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [agent, setAgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (agent) body.append("agent", "1");
      const res = await fetch("/api/payments/statements", { method: "POST", body });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || "The statement could not be read");
        return;
      }
      setResult(json);
      toast.success(`${json.tradeLines} trade lines read, ${json.stored} saved`);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Landmark className="h-4 w-4 text-teal-700" />
            Bank statement
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-zinc-500">
            Banks that email an encrypted file (HSBC) cannot be read from the mail. Download the statement or the credit / debit advice from the bank as a PDF, Excel or CSV, upload it here and press Read statement.
            Trade lines are matched to payment emails and POs; salary, loan, tax and card lines are counted and dropped, and the file is not kept.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.html,.htm,.txt"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            <FileUp className="mr-1.5 h-4 w-4" />
            {file ? file.name.slice(0, 28) : "Choose statement"}
          </Button>
          <Button onClick={() => void run()} disabled={!file || busy}>
            {busy ? "Reading…" : "Read statement"}
          </Button>
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
        <input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} />
        Use the AI reader (for layouts the built-in reader cannot place; slower)
      </label>
      {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {result ? (
        <div className="mt-3 space-y-2 text-xs text-zinc-700">
          <p>
            Read <b>{result.lines}</b> lines ({result.period.from} to {result.period.to}, {result.currency}, {result.usedAgent ? "AI reader" : result.method}):{" "}
            <b>{result.tradeLines}</b> trade lines, <b>{result.matchedToEmail}</b> matched to a payment email, <b>{result.matchedToPo}</b> to a PO. {result.dropped} other lines dropped
            {result.alreadyStored ? `, ${result.alreadyStored} already saved` : ""}
            {result.skipped ? `, ${result.skipped} lines could not be placed` : ""}.
          </p>
          {result.trade.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="border-b py-1 pr-2">Date</th>
                  <th className="border-b py-1 pr-2">Line</th>
                  <th className="border-b py-1 pr-2">Amount</th>
                  <th className="border-b py-1 pr-2">Payment email</th>
                  <th className="border-b py-1">PO</th>
                </tr>
              </thead>
              <tbody>
                {result.trade.map((t, i) => (
                  <tr key={`${t.date}-${t.reference}-${i}`} className="align-top">
                    <td className="border-b py-1 pr-2">{t.date}</td>
                    <td className="border-b py-1 pr-2">{KIND[t.kind] || t.kind}</td>
                    <td className="border-b py-1 pr-2 font-medium">{money(t.amount, t.currency)}</td>
                    <td className="border-b py-1 pr-2">{t.email ? t.email.subject.slice(0, 60) : <span className="text-zinc-400">none found</span>}</td>
                    <td className="border-b py-1">{t.pos.length ? t.pos.join(", ") : <span className="text-zinc-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-zinc-500">No trade lines in this statement.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
