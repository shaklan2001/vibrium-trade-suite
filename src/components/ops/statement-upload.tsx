"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check, FileText, FileUp, Landmark, RotateCcw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui/primitives";
import { SIDE_LABEL, type DealUpdateDealRef, type DealUpdateRecord } from "@/lib/trade/dealUpdate";
import { emitDealUpdatesChanged, onDealUpdatesChanged, rememberAuthor, storedAuthor } from "@/lib/trade/dealUpdateEvents";
import { cn } from "@/lib/utils";

type Status = "matched" | "po_found" | "unmatched" | "recorded" | "ignored";

type Line = {
  id: string;
  date: string;
  kind: string;
  amountInr: number;
  currency?: string;
  reference: string | null;
  particulars: string;
  party?: string | null;
  gross?: number | null;
  charges?: { currency: string; amount: number } | null;
  emailId: string | null;
  pos: string[];
  poHow: string | null;
  invoiceNo: string | null;
  source?: string;
  file?: { name: string; sha256: string } | null;
  status: Status;
  suggestions: DealUpdateDealRef[];
  reconciled?: { status: string; dealCode: string | null; href: string | null; po: string | null; side: string | null; amount: number | null; by: string; at: string } | null;
};

type UploadResult = { ok: boolean; ids?: string[]; lines: number; tradeLines: number; stored: number; alreadyStored: number; dropped: number; error?: string };

type Tab = "open" | "recorded" | "matched" | "ignored";
const TABS: { key: Tab; label: string; has: (s: Status) => boolean }[] = [
  { key: "open", label: "Needs a deal", has: (s) => s === "unmatched" || s === "po_found" },
  { key: "recorded", label: "Recorded", has: (s) => s === "recorded" },
  { key: "matched", label: "Matched to email", has: (s) => s === "matched" },
  { key: "ignored", label: "Not a deal payment", has: (s) => s === "ignored" },
];

const fmt = (n: number, cur: string) => `${cur} ${n.toLocaleString(cur === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Sa|De|Cv|Llc|Ltd|Na)\b/g, (m) => m.toUpperCase());

/**
 * Upload HSBC credit / debit advices or a bank statement (PDF, also Excel / CSV). Each payment is
 * matched to a payment email or PO; the ones nothing in the book names wait under "Needs a deal",
 * where a person picks the deal and confirms — that records the payment on the PO, adds a team note
 * and notifies the team. Nothing is recorded without that confirmation.
 */
export function StatementUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Line[] | null>(null);
  const [tab, setTab] = useState<Tab>("open");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/payments/bank-lines?suggest=1", { cache: "no-store" });
      const j = (await r.json()) as { lines?: Line[] };
      setLines(j.lines || []);
    } catch {
      setLines((l) => l || []);
    }
  }, []);

  useEffect(() => {
    void load();
    return onDealUpdatesChanged(() => void load());
  }, [load]);

  async function run() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    const ids = new Set<string>();
    const failed: string[] = [];
    let read = 0;
    let trade = 0;
    let again = 0;
    for (const file of files) {
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/payments/statements", { method: "POST", body });
        const json = (await res.json()) as UploadResult;
        if (!res.ok || !json.ok) {
          failed.push(`${file.name}: ${json.error || "could not be read"}`);
          continue;
        }
        read += 1;
        trade += json.tradeLines;
        again += json.alreadyStored;
        for (const id of json.ids || []) ids.add(id);
      } catch {
        failed.push(`${file.name}: upload failed, check your connection`);
      }
    }
    setBusy(false);
    setFresh(ids);
    setFiles([]);
    if (input.current) input.current.value = "";
    if (failed.length) setError(failed.join("\n"));
    await load();
    if (read) {
      setSummary(
        `${read} file${read === 1 ? "" : "s"} read · ${ids.size} payment${ids.size === 1 ? "" : "s"}${again ? ` (${again} uploaded before)` : ""}${trade === 0 && !ids.size ? " · no trade payments in these files" : ""}.`,
      );
      toast.success(`${ids.size} bank payment${ids.size === 1 ? "" : "s"} read`);
      setTab("open");
    }
  }

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, (lines || []).filter((l) => t.has(l.status)).length])) as Record<Tab, number>, [lines]);
  const shown = useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    return (lines || []).filter((l) => t.has(l.status)).sort((a, b) => Number(fresh.has(b.id)) - Number(fresh.has(a.id)) || b.date.localeCompare(a.date));
  }, [lines, tab, fresh]);
  const freshOpen = (lines || []).filter((l) => fresh.has(l.id));

  return (
    <Card className="br-card mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Landmark className="h-4 w-4 text-teal-700" aria-hidden />
            Bank advices &amp; statements
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-zinc-500">
            Upload the HSBC credit / debit advice PDFs (or a statement). Each payment is matched to its payment email or PO. The ones we can&apos;t place wait under{" "}
            <b>Needs a deal</b>: pick the deal, confirm, and the payment is recorded on the PO and the team is told. Each PDF is kept with the other documents. Salary, loan, tax and card lines are dropped.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.html,.htm,.txt"
            className="hidden"
            onChange={(e) => {
              setFiles(Array.from(e.target.files || []));
              setError(null);
              setSummary(null);
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            <FileUp className="mr-1.5 h-4 w-4" aria-hidden />
            {files.length === 1 ? files[0]!.name.slice(0, 28) : files.length ? `${files.length} files chosen` : "Choose PDFs"}
          </Button>
          <Button onClick={() => void run()} disabled={!files.length || busy}>
            {busy ? "Reading…" : files.length > 1 ? `Read ${files.length} files` : "Read & match"}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-3 whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {summary ? (
        <p className="br-summary">
          <Check className="h-3.5 w-3.5" aria-hidden />
          <span>
            {summary}{" "}
            {freshOpen.length ? (
              <>
                {freshOpen.filter((l) => l.status === "matched" || l.status === "recorded").length} matched,{" "}
                <b>{freshOpen.filter((l) => l.status === "unmatched" || l.status === "po_found").length} need a deal</b>.
              </>
            ) : null}
          </span>
        </p>
      ) : null}

      <div className="br-tabs" role="tablist" aria-label="Bank lines">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={cn("br-tab", tab === t.key && "br-tab-on")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className={cn("br-count", t.key === "open" && counts.open > 0 && "br-count-warn")}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {lines === null ? (
        <p className="br-empty">Loading bank lines…</p>
      ) : !shown.length ? (
        <p className="br-empty">
          {tab === "open"
            ? lines.length
              ? "Every bank payment is matched. Upload new advices when they arrive."
              : "No bank payments yet. Upload an HSBC credit advice PDF to start."
            : "Nothing here."}
        </p>
      ) : (
        <ul className="br-list">
          {shown.map((l) => (
            <BankRow
              key={l.id}
              line={l}
              isNew={fresh.has(l.id)}
              open={open === l.id}
              onToggle={() => setOpen((o) => (o === l.id ? null : l.id))}
              onChanged={(update) => {
                setOpen(null);
                // Reloads this list, the Off-mail updates feed and any open ledger.
                emitDealUpdatesChanged(update ?? null);
              }}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATUS_CHIP: Record<Status, { label: string; cls: string }> = {
  unmatched: { label: "Needs a deal", cls: "br-chip-warn" },
  po_found: { label: "PO found · confirm", cls: "br-chip-info" },
  matched: { label: "Matched to payment email", cls: "br-chip-ok" },
  recorded: { label: "Recorded", cls: "br-chip-ok" },
  ignored: { label: "Not a deal payment", cls: "" },
};

function BankRow({ line, isNew, open, onToggle, onChanged }: { line: Line; isNew: boolean; open: boolean; onToggle: () => void; onChanged: (u?: DealUpdateRecord) => void }) {
  const cur = line.currency || "INR";
  const credit = line.amountInr > 0;
  const net = Math.abs(line.amountInr);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const chip = STATUS_CHIP[line.status];
  const who = line.party ? titleCase(line.party) : line.particulars.slice(0, 70);

  async function reopen() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/payments/bank-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen", id: line.id, by: storedAuthor() || "team" }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) toast.error(j.error || "Could not undo");
      else toast.success(line.status === "recorded" ? "Payment taken back; the line needs a deal again" : "Moved back to Needs a deal");
      onChanged();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <li className={cn("br-row", open && "br-row-open")}>
      <div className="br-row-main">
        <span className={cn("br-dir", credit ? "br-dir-in" : "br-dir-out")} aria-hidden>
          {credit ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="br-who">
            {credit ? "From " : "To "}
            {who}
            {isNew ? <span className="br-new">New</span> : null}
          </p>
          <div className="br-meta">
            <span>{day(line.date)}</span>
            {line.reference ? <span className="br-ref">Ref {line.reference}</span> : null}
            {line.source === "upload" ? <span>Uploaded</span> : line.source === "mail" ? <span>From statement mail</span> : null}
            {line.pos.length && line.status !== "recorded" ? <span>PO {line.pos.join(", ")}</span> : null}
            {line.file ? (
              <a
                className="br-file"
                href={`/api/ingest-files?digest=${line.file.sha256}&name=${encodeURIComponent(line.file.name)}`}
                target="_blank"
                rel="noreferrer"
              >
                <FileText className="h-3 w-3" aria-hidden />
                View advice
              </a>
            ) : null}
          </div>
          {line.status === "recorded" && line.reconciled ? (
            <p className="br-done">
              <Check className="h-3.5 w-3.5" aria-hidden />
              On{" "}
              {line.reconciled.href ? (
                <Link href={line.reconciled.href} className="br-deal">
                  {line.reconciled.dealCode}
                </Link>
              ) : (
                line.reconciled.dealCode
              )}
              {line.reconciled.po ? ` · PO ${line.reconciled.po}` : ""}
              {line.reconciled.side && line.reconciled.side !== "buyer" ? ` · ${SIDE_LABEL[line.reconciled.side as keyof typeof SIDE_LABEL]?.toLowerCase() || line.reconciled.side}` : ""} · by {line.reconciled.by}
            </p>
          ) : null}
        </div>
        <div className="br-right">
          <span className={cn("br-amt", credit ? "br-amt-in" : "br-amt-out")}>
            {credit ? "+" : "−"}
            {fmt(line.gross || net, cur)}
          </span>
          {line.gross && line.gross !== net ? (
            <span className="br-net">
              {fmt(net, cur)} credited{line.charges ? ` · ${fmt(line.charges.amount, line.charges.currency)} bank charges` : ""}
            </span>
          ) : null}
          <span className={cn("br-chip", chip.cls)}>{chip.label}</span>
          {line.status === "unmatched" || line.status === "po_found" ? (
            <button type="button" className="br-match" onClick={onToggle} aria-expanded={open}>
              {open ? "Close" : "Match to deal"}
            </button>
          ) : line.status === "recorded" || line.status === "ignored" ? (
            <button type="button" className="du-text-btn" onClick={() => void reopen()} onBlur={() => setArmed(false)} disabled={busy}>
              <RotateCcw className="h-3 w-3" aria-hidden />
              {busy ? "Undoing…" : armed ? "Confirm undo" : line.status === "recorded" ? "Undo" : "Reopen"}
            </button>
          ) : null}
        </div>
      </div>
      {open ? <ReconcileForm line={line} onDone={onChanged} onCancel={onToggle} /> : null}
    </li>
  );
}

function ReconcileForm({ line, onDone, onCancel }: { line: Line; onDone: (u?: DealUpdateRecord) => void; onCancel: () => void }) {
  const cur = line.currency || "INR";
  const credit = line.amountInr > 0;
  const net = Math.abs(line.amountInr);
  const [deal, setDeal] = useState<DealUpdateDealRef | null>(line.status === "po_found" ? line.suggestions[0] ?? null : null);
  const [po, setPo] = useState<string>(line.pos[0] || deal?.pos[0] || "");
  const [side, setSide] = useState<string>(credit ? "buyer" : "factory");
  const [basis, setBasis] = useState<"gross" | "net">("gross");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DealUpdateDealRef[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setAuthor(storedAuthor()), []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/copilot/updates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", q }),
          signal: ctl.signal,
        });
        const j = (await r.json()) as { deals?: DealUpdateDealRef[] };
        setResults(j.deals || []);
      } catch {
        /* aborted or offline */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  function pick(d: DealUpdateDealRef) {
    setDeal(d);
    setPo(line.pos.find((p) => d.pos.includes(p)) || d.pos[0] || "");
    setQ("");
    setResults(null);
  }

  const amount = basis === "gross" && line.gross ? line.gross : net;
  const mismatch = deal?.currency && deal.currency !== cur;
  const missing = !deal ? "Pick the deal this payment is for." : !author.trim() ? "Add your name so the team knows who recorded it." : null;

  async function save() {
    if (!deal || missing || saving) return;
    setSaving(true);
    setErr(null);
    rememberAuthor(author);
    try {
      const r = await fetch("/api/payments/bank-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile", confirmed: true, id: line.id, dealId: deal.id, po: po || null, side, basis, author, note }),
      });
      const j = (await r.json()) as { update?: DealUpdateRecord; error?: string };
      if (!r.ok || !j.update) {
        setErr(j.error || "Could not record the payment.");
        return;
      }
      toast.success(`Recorded on ${j.update.dealCode}${po ? ` · PO ${po}` : ""}. The team has been notified.`);
      onDone(j.update);
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function ignore() {
    setSaving(true);
    try {
      const r = await fetch("/api/payments/bank-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignore", id: line.id, by: author || storedAuthor() || "team" }),
      });
      if (r.ok) {
        toast.success("Marked as not a deal payment");
        onDone();
      } else setErr(((await r.json()) as { error?: string }).error || "Could not update the line.");
    } finally {
      setSaving(false);
    }
  }

  const options = results ?? line.suggestions;

  return (
    <div className="br-form">
      <div className="br-form-grid">
        <div className="du-field">
          <span className="du-label">Deal</span>
          {deal ? (
            <div className="du-deal">
              <div>
                <p className="du-deal-code">{deal.code}</p>
                <p className="du-deal-title">{deal.title}</p>
              </div>
              <button type="button" className="du-text-btn" onClick={() => setDeal(null)}>
                Change
              </button>
            </div>
          ) : (
            <div className="du-picker">
              <label className="du-picker-input">
                <Search className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO, deal code, buyer or factory" aria-label="Search deals" />
              </label>
              {options.length ? (
                <>
                  {!results ? <p className="br-sugg-label">Suggested from the payer / PO</p> : null}
                  <ul className="du-picker-list">
                    {options.map((d) => (
                      <li key={d.id}>
                        <button type="button" className="du-deal-option" onClick={() => pick(d)}>
                          <span className="du-deal-code">{d.code}</span>
                          <span className="du-deal-title block">{d.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="du-picker-empty">
                  {results ? "No deal matches. Try the PO number or the buyer's name." : `Nothing in the book names ${line.party ? titleCase(line.party) : "this payer"}. Search by PO or buyer.`}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3">
          {deal ? (
            <label className="du-field">
              <span className="du-label">PO</span>
              <select className="du-input" value={po} onChange={(e) => setPo(e.target.value)}>
                {deal.pos.map((p) => (
                  <option key={p} value={p}>
                    PO {p}
                  </option>
                ))}
                <option value="">No single PO (whole deal)</option>
              </select>
            </label>
          ) : null}
          <div className="du-field">
            <span className="du-label">{credit ? "Who paid us" : "Who we paid"}</span>
            <div className="du-seg" role="radiogroup" aria-label="Payment side">
              {(credit ? ["buyer", "commission", "other"] : ["factory", "freight", "other"]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={side === s} className={cn("du-seg-btn", side === s && "du-seg-on")} onClick={() => setSide(s)}>
                  {SIDE_LABEL[s as keyof typeof SIDE_LABEL]}
                </button>
              ))}
            </div>
          </div>
          {line.gross && line.gross !== net ? (
            <div className="du-field">
              <span className="du-label">Amount to record</span>
              <div className="du-seg" role="radiogroup" aria-label="Amount">
                <button type="button" role="radio" aria-checked={basis === "gross"} className={cn("du-seg-btn", basis === "gross" && "du-seg-on")} onClick={() => setBasis("gross")}>
                  {fmt(line.gross, cur)} sent
                </button>
                <button type="button" role="radio" aria-checked={basis === "net"} className={cn("du-seg-btn", basis === "net" && "du-seg-on")} onClick={() => setBasis("net")}>
                  {fmt(net, cur)} credited
                </button>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="du-field">
              <span className="du-label">Your name</span>
              <input className="du-input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Radha" maxLength={80} />
            </label>
            <label className="du-field">
              <span className="du-label">Note (optional)</span>
              <input className="du-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 50% advance" maxLength={500} />
            </label>
          </div>
        </div>
      </div>

      <div className="du-preview">
        <p>
          {deal ? (
            <>
              Records <b>{credit ? "payment received" : "payment sent"} {fmt(amount, cur)}</b>
              {side !== (credit ? "buyer" : "factory") ? ` (${SIDE_LABEL[side as keyof typeof SIDE_LABEL].toLowerCase()})` : ""} on <b>{deal.code}</b>
              {po ? ` · PO ${po}` : ""} dated {day(line.date)}, adds a team note and notifies the team.
            </>
          ) : (
            "Pick a deal to see what will be recorded."
          )}
        </p>
        {mismatch ? <p className="du-missing">This deal is in {deal!.currency}; the payment is in {cur}. Check it&apos;s the right deal.</p> : null}
      </div>
      {err ? <p className="du-error">{err}</p> : null}
      <div className="br-actions">
        <button type="button" className="du-text-btn" onClick={() => void ignore()} disabled={saving}>
          Not a deal payment
        </button>
        <span className="flex-1" />
        <button type="button" className="du-text-btn" onClick={onCancel} disabled={saving}>
          <X className="h-3 w-3" aria-hidden /> Cancel
        </button>
        <button type="button" className="du-confirm" onClick={() => void save()} disabled={Boolean(missing) || saving} title={missing || undefined}>
          {saving ? "Recording…" : "Confirm & record"}
        </button>
      </div>
      {missing && deal ? <p className="du-missing text-right">{missing}</p> : null}
    </div>
  );
}
