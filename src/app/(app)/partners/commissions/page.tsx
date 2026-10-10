"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Label,
  Stat,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { useAgencyCommissionStore } from "@/lib/trade/agencyCommissionStore";
import {
  DEFAULT_AGENCY_COMMISSION_PCT,
  discoverBuyersFromDeals,
  seedDefaultRatesForDeals,
} from "@/lib/trade/agencyCommission";

export default function AgencyCommissionsPage() {
  const deals = useVisibleDeals();
  const allDeals = useTradeStore((s) => s.deals);
  const rates = useAgencyCommissionStore((s) => s.rates);
  const upsertRate = useAgencyCommissionStore((s) => s.upsertRate);
  const removeRate = useAgencyCommissionStore((s) => s.removeRate);
  const setPct = useAgencyCommissionStore((s) => s.setPct);

  const [newBuyer, setNewBuyer] = useState("");
  const [newPct, setNewPct] = useState(String(DEFAULT_AGENCY_COMMISSION_PCT));
  const [newNotes, setNewNotes] = useState("");

  const book = allDeals.length ? allDeals : deals;

  // Persist 5% for every Agency buyer seen in the book (once per missing buyer).
  useEffect(() => {
    const added = seedDefaultRatesForDeals(book, rates, upsertRate);
    if (added > 0) {
      toast.success(
        `Set default ${DEFAULT_AGENCY_COMMISSION_PCT}% on ${added} buyer(s)`,
      );
    }
    // Only re-run when deal set grows / rates empty — upsert is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional seed on book change
  }, [book.length]);

  const discovered = useMemo(
    () => discoverBuyersFromDeals(book),
    [book],
  );

  const rateMap = useMemo(() => {
    const m = new Map(rates.map((r) => [r.buyerKey, r]));
    return m;
  }, [rates]);

  const rows = useMemo(() => {
    const keys = new Set<string>([
      ...discovered.map((d) => d.buyerKey),
      ...rates.map((r) => r.buyerKey),
    ]);
    return [...keys]
      .map((key) => {
        const disc = discovered.find((d) => d.buyerKey === key);
        const rate = rateMap.get(key);
        return {
          buyerKey: key,
          buyerName: rate?.buyerName || disc?.buyerName || key,
          dealCount: disc?.dealCount || 0,
          pct: rate?.pct,
          notes: rate?.notes || "",
          configured: Boolean(rate),
          updatedAt: rate?.updatedAt,
        };
      })
      .sort(
        (a, b) =>
          Number(b.configured) - Number(a.configured) ||
          b.dealCount - a.dealCount ||
          a.buyerName.localeCompare(b.buyerName),
      );
  }, [discovered, rates, rateMap]);

  const configured = rows.filter((r) => r.configured).length;
  const missing = rows.filter((r) => !r.configured && r.dealCount > 0).length;

  function seedMissing() {
    const n = seedDefaultRatesForDeals(book, rates, upsertRate);
    toast.success(
      n
        ? `Set default ${DEFAULT_AGENCY_COMMISSION_PCT}% on ${n} buyer(s)`
        : `All buyers already have a rate (default ${DEFAULT_AGENCY_COMMISSION_PCT}%)`,
    );
  }

  function addBuyer() {
    const name = newBuyer.trim();
    if (!name) {
      toast.error("Buyer name required");
      return;
    }
    const pct = Number(newPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error("Commission % must be 0–100");
      return;
    }
    upsertRate({
      buyerName: name,
      pct,
      notes: newNotes.trim() || undefined,
    });
    setNewBuyer("");
    setNewNotes("");
    toast.success(`Saved ${name} @ ${pct}%`);
  }

  return (
    <div>
      <PageHeader
        title="Agency commissions"
        description={`Fixed buyer → commission % for Savvy Net (Agency) book. New buyers default to ${DEFAULT_AGENCY_COMMISSION_PCT}%. Deal extracts stay unchanged.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/finance">
              <Button variant="ghost">Finance</Button>
            </Link>
            <Link href="/partners">
              <Button variant="secondary">Supplier Hub</Button>
            </Link>
            <Button variant="secondary" onClick={seedMissing}>
              Apply {DEFAULT_AGENCY_COMMISSION_PCT}% to missing buyers
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Buyers configured" value={configured} />
        <Stat label="Missing on Agency deals" value={missing} />
        <Stat label="Agency buyers seen" value={discovered.length} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Add / update buyer rate"
          description="Percentage is fixed over time — one rate per buyer company"
        />
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label>Buyer company</Label>
            <Input
              value={newBuyer}
              onChange={(e) => setNewBuyer(e.target.value)}
              placeholder="e.g. Petrageous Designs"
            />
          </div>
          <div>
            <Label>Commission %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={newPct}
              onChange={(e) => setNewPct(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={addBuyer}>
              Save rate
            </Button>
          </div>
          <div className="sm:col-span-4">
            <Label>Notes (optional)</Label>
            <Input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Contract reference, PO series, etc."
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Buyer rates"
          description="Unconfigured Agency deals show ₹0 commission with a warning on Finance"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Buyer</th>
                <th className="px-4 py-2 font-medium">Deals</th>
                <th className="px-4 py-2 font-medium">Commission %</th>
                <th className="px-4 py-2 font-medium">Notes</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-zinc-500">
                    No Agency buyers yet — load mailbox deals, then seed.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.buyerKey}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900">{r.buyerName}</div>
                      <div className="font-mono text-[10px] text-zinc-400">
                        {r.buyerKey}
                      </div>
                      {!r.configured ? (
                        <Badge tone="warning">Not configured</Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{r.dealCount}</td>
                    <td className="px-4 py-3">
                      <Input
                        className="w-24"
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={r.pct ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const pct = Number(e.target.value);
                          if (!r.configured) {
                            upsertRate({
                              buyerName: r.buyerName,
                              pct: Number.isFinite(pct) ? pct : 0,
                            });
                          } else if (Number.isFinite(pct)) {
                            setPct(r.buyerKey, pct);
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {r.notes || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.configured ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            removeRate(r.buyerKey);
                            toast.message(`Removed ${r.buyerName}`);
                          }}
                        >
                          Remove
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            upsertRate({
                              buyerName: r.buyerName,
                              pct: DEFAULT_AGENCY_COMMISSION_PCT,
                              notes: `Default ${DEFAULT_AGENCY_COMMISSION_PCT}%`,
                            })
                          }
                        >
                          Set {DEFAULT_AGENCY_COMMISSION_PCT}%
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
