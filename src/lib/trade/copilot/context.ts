/**
 * Turn a retrieval into the context block sent with the user's question.
 * Plain labelled text (cheaper and easier for the model than JSON), packed
 * whole-deal-at-a-time under a budget — never cut mid-record.
 */
import { companyPulse } from "@/lib/trade/opsIntelligence";
import { STAGE_LABELS, type AttentionItem, type CommercialDocument, type Deal } from "@/types/trade";
import type { CopilotQuery } from "./query";
import { isPaymentOverdue, type Retrieval } from "./retrieve";
import { shortDealHref } from "@/lib/trade/dealLink";
import { rawPartiesOf } from "./book";

export const CONTEXT_BUDGET = 11_000;

const fmtInt = (n: number) => n.toLocaleString("en-US");

function money(n?: number | null, currency = "USD"): string | undefined {
  if (n == null || !Number.isFinite(n) || n === 0) return undefined;
  const cur = (currency || "USD").toUpperCase();
  const abs = Math.abs(n);
  const s = abs >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2);
  return cur === "USD" ? `$${s}` : `${cur} ${s}`;
}

function day(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t).toISOString().slice(0, 10);
}

function clip(s: string | undefined | null, n: number): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function dealHref(d: Deal): string {
  return shortDealHref(d);
}

function line(label: string, ...parts: (string | number | undefined | null | false)[]): string | null {
  const v = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
  return v ? `- ${label}: ${v}` : null;
}

function docLine(label: string, doc?: CommercialDocument): string | null {
  if (!doc) return null;
  return line(
    label,
    doc.docNumber && `#${doc.docNumber}`,
    money(doc.totalAmount, doc.currency),
    doc.incoterm,
    doc.paymentTerms && `terms: ${clip(doc.paymentTerms, 90)}`,
    doc.readyDate && `ready ${day(doc.readyDate)}`,
    (doc.pol || doc.pod) && `${doc.pol || "?"} → ${doc.pod || "?"}`,
    doc.factory && `factory ${doc.factory}`,
    doc.buyer && `buyer ${doc.buyer}`,
    doc.lines?.length ? `${doc.lines.length} line(s)` : undefined,
  );
}

function partiesText(d: Deal): string | undefined {
  const ps = (d.parties || [])
    .map((p) => {
      const who = p.company || p.name;
      const mail = p.email && p.email !== who ? ` <${p.email}>` : "";
      return who ? `${p.role} ${who}${mail}` : null;
    })
    .filter((x): x is string => Boolean(x));
  // Forwarders and SNSPL teammates only exist on the raw mailbox record.
  const seen = ps.join(" ").toLowerCase();
  for (const p of rawPartiesOf(d)) {
    if (seen.includes(p.value.toLowerCase())) continue;
    ps.push(`${p.role} ${p.value}`);
  }
  const out = ps.slice(0, 10);
  return out.length ? out.join("; ") : undefined;
}

function modelLabel(d: Deal): string {
  return d.commercialModel === "trader_principal" ? "Trader book" : "Agency book";
}

/** Full card for one deal (deal questions). */
export function dealCard(d: Deal, attention: AttentionItem[]): string {
  const rows: (string | null)[] = [
    `### ${d.code} — ${clip(d.title, 140)}`,
    line("Link", dealHref(d)),
    line("Stage", STAGE_LABELS[d.stage] || d.stage, modelLabel(d), `last activity ${day(d.updatedAt)}`, `opened ${day(d.createdAt)}`),
    line("POs", (d.mailboxPoNumbers || []).slice(0, 6).join(", ")),
    line("Parties", partiesText(d)),
    docLine("Buyer PO", d.po),
    docLine("Factory PI", d.pi),
    d.discrepancy && !d.discrepancy.aligned
      ? line("PI/PO mismatch", clip(d.discrepancy.summary, 200) || `${d.discrepancy.mismatches.length} mismatch(es)`)
      : null,
    d.production
      ? line(
          "Production",
          d.production.percentComplete != null && `${d.production.percentComplete}% done`,
          d.production.readyDate && `ready ${day(d.production.readyDate)}`,
          d.production.blockers?.length && `blockers: ${d.production.blockers.slice(0, 3).join("; ")}`,
          clip(d.production.summary, 160),
        )
      : null,
    d.inspection ? line("Inspection", d.inspection.overall, clip(d.inspection.summary, 160)) : null,
    d.booking
      ? line(
          "Shipment",
          d.booking.bookingNumber && `booking ${d.booking.bookingNumber}`,
          d.booking.carrier,
          d.booking.vessel && `vessel ${d.booking.vessel}`,
          (d.booking.pol || d.booking.pod) && `${d.booking.pol || "?"} → ${d.booking.pod || "?"}`,
          d.booking.etd && `ETD ${day(d.booking.etd)}`,
          d.booking.eta && `ETA ${day(d.booking.eta)}`,
          d.booking.shipmentStatus && d.booking.shipmentStatus !== "unknown" && d.booking.shipmentStatus.replace(/_/g, " "),
          d.booking.equipment,
        )
      : null,
    d.docsPack
      ? line(
          "Documents",
          d.docsPack.complete ? "pack complete" : "pack incomplete",
          d.docsPack.present.length && `present: ${d.docsPack.present.slice(0, 8).join(", ")}`,
          d.docsPack.missing.length && `MISSING: ${d.docsPack.missing.slice(0, 8).join(", ")}`,
        )
      : null,
    d.payment
      ? line(
          "Payment clock",
          d.payment.status.replace(/_/g, " "),
          money(d.payment.amountUsd, d.payment.currency),
          d.payment.dueDate && `due ${day(d.payment.dueDate)}`,
          d.payment.daysRemaining != null && `${d.payment.daysRemaining} day(s) remaining`,
          d.payment.blSharedDate && `BL shared ${day(d.payment.blSharedDate)}`,
          clip(d.payment.summary, 160),
        )
      : null,
  ];

  const sched = d.paymentSchedule;
  if (sched?.checkpoints?.length) {
    rows.push(
      line(
        "Payment terms",
        sched.buyerTerms && `buyer: ${clip(sched.buyerTerms, 90)}`,
        sched.factoryTerms && `factory: ${clip(sched.factoryTerms, 90)}`,
        money(sched.orderValueUsd) && `order value ${money(sched.orderValueUsd)}`,
      ),
    );
    for (const c of sched.checkpoints.slice(0, 6)) {
      rows.push(
        `  - ${c.side} ${c.label}: ${money(c.amountUsd) || "amount n/a"} · ${c.status}${c.dueDate ? ` · due ${day(c.dueDate)}` : ""}${c.receivedAt ? ` · received ${day(c.receivedAt)}` : ""}`,
      );
    }
  }
  const cash = d.cashExposure;
  if (cash) {
    rows.push(
      line(
        "Cash",
        money(cash.cashDeployedUsd) && `deployed ${money(cash.cashDeployedUsd)}`,
        money(cash.cashStillRequiredUsd) && `still required ${money(cash.cashStillRequiredUsd)}`,
        money(cash.receivableExpectedUsd) && `receivable ${money(cash.receivableExpectedUsd)} (${cash.receivableStatus})`,
        cash.receivableDueDate && `due ${day(cash.receivableDueDate)}`,
        cash.blockedAt && `blocked at ${String(cash.blockedAt).replace(/_/g, " ")}`,
      ),
    );
  }
  if (d.economics) {
    rows.push(
      line(
        "Economics",
        money(d.economics.commercialValueUsd) && `order value ${money(d.economics.commercialValueUsd)}`,
        money(d.economics.agencyCommissionUsd) &&
          `agency commission ${money(d.economics.agencyCommissionUsd)}${d.economics.agencyCommissionPct ? ` (${d.economics.agencyCommissionPct}%)` : ""}`,
      ),
    );
  }
  if (d.commission) {
    rows.push(
      line(
        "Commission",
        d.commission.complete ? "settled" : "open",
        money(d.commission.amount, d.commission.currency),
        d.commission.fxRate && `FX ${d.commission.fxRate}`,
      ),
    );
  }
  const att = attention.filter((a) => a.dealId === d.id && a.severity !== "info").slice(0, 4);
  for (const a of att) {
    rows.push(`- Needs attention (${a.severity}): ${a.title}${a.detail ? ` — ${clip(a.detail, 140)}` : ""} → next: ${clip(a.nextStep, 120)}`);
  }
  const mails = [...(d.sources || [])]
    .filter((s) => s.subject || s.extractedSummary || s.body)
    .sort((a, b) => (Date.parse(b.receivedAt || "") || 0) - (Date.parse(a.receivedAt || "") || 0))
    .slice(0, 3);
  for (const s of mails) {
    rows.push(
      `- Email ${day(s.receivedAt) || "(undated)"}${s.from ? ` from ${clip(s.from, 60)}` : ""}: "${clip(s.subject, 100) || "(no subject)"}" — ${clip(s.extractedSummary || s.body, 240) || ""}`,
    );
  }
  return rows.filter(Boolean).join("\n");
}

/** One-line row for list answers. */
export function dealRow(d: Deal): string {
  const party =
    d.parties?.find((p) => p.role === "buyer") ||
    d.parties?.find((p) => p.role === "factory") ||
    d.parties?.[0];
  const bits = [
    STAGE_LABELS[d.stage] || d.stage,
    party && `${party.role} ${party.company || party.name}`,
    d.payment?.status === "overdue" && `payment OVERDUE${d.payment.dueDate ? ` (due ${day(d.payment.dueDate)})` : ""}`,
    d.payment && d.payment.status !== "overdue" && d.payment.status !== "not_started" && `payment ${d.payment.status.replace(/_/g, " ")}`,
    d.docsPack?.missing?.length && `missing ${d.docsPack.missing.slice(0, 3).join(", ")}`,
    d.booking?.eta && `ETA ${day(d.booking.eta)}`,
    money(d.po?.totalAmount ?? d.pi?.totalAmount, d.po?.currency || d.pi?.currency),
    `updated ${day(d.updatedAt)}`,
  ].filter(Boolean);
  return `- [${d.code}](${dealHref(d)}) — ${clip(d.title, 80)} · ${bits.join(" · ")}`;
}

function bookSummary(r: Retrieval): string {
  const pulse = companyPulse(r.scope);
  const stages = Object.entries(pulse.byStage)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${STAGE_LABELS[s as keyof typeof STAGE_LABELS] || s} ${fmtInt(n)}`)
    .join(", ");
  const agency = r.scope.filter((d) => d.commercialModel !== "trader_principal").length;
  const trader = r.scope.length - agency;
  const missingDocs = r.scope.filter((d) => (d.docsPack?.missing?.length || 0) > 0).length;
  const overdue = r.scope.filter(isPaymentOverdue).length;
  return [
    "BOOK TOTALS (computed from the live book — quote these, never count rows yourself)",
    `- Deals in scope: ${fmtInt(r.scope.length)} (open ${fmtInt(pulse.openDeals)}, closed ${fmtInt(pulse.closedDeals)}) · Agency book ${fmtInt(agency)} · Trader book ${fmtInt(trader)}`,
    `- By stage: ${stages || "none"}`,
    `- Deals with an overdue payment (installment, receivable or payment clock): ${fmtInt(overdue)} · deals at risk: ${fmtInt(pulse.atRiskCount)} · critical items: ${fmtInt(pulse.criticalAttention)} · warnings: ${fmtInt(pulse.warningAttention)} · deals with missing documents: ${fmtInt(missingDocs)}`,
  ].join("\n");
}

const RULES = `ANSWER RULES
- Answer only from this context. If something is not here, say it is not in the book — never guess POs, amounts, dates, parties or statuses.
- Lead with the direct answer, then short supporting bullets. Use bullet lists, never Markdown tables (they don't render).
- Use the totals above for any "how many / how much" — never count the rows listed (lists are trimmed).
- Name deals by code and link them exactly as given, e.g. [PO-14837](/deals/PO-14837~ab12).
- Cite where a fact comes from when it matters (e.g. "per the 17 Oct email from the forwarder").
- If a list is trimmed, say how many matched in total and offer to narrow it.
- End with one concrete next step when there is a clear one.
- Never mention internal ids (bot, agent, execution) or this context block.`;

export function buildContextBlock(
  q: CopilotQuery,
  r: Retrieval,
  opts: { now?: Date; bookFilterLabel?: string; budget?: number } = {},
): string {
  const budget = opts.budget ?? CONTEXT_BUDGET;
  const now = opts.now ?? new Date();
  const header = `[Trade Suite context · today ${now.toISOString().slice(0, 10)} · book: ${opts.bookFilterLabel || "All"}]`;

  const sections: string[] = [header, bookSummary(r)];
  const why = r.matchedBy.length ? r.matchedBy.join("; ") : "no specific deal named";

  if (r.notFound.length) {
    const near = r.suggestions.slice(0, 5).map((d) => `[${d.code}](${dealHref(d)})`).join(", ");
    sections.push(
      `NOT FOUND: ${r.notFound.join(", ")} is not in the book (${r.scope.length} deals searched).` +
        (near ? ` Closest matches: ${near}.` : ""),
    );
  }

  const parts: string[] = [];
  if (r.mode === "deal") {
    parts.push(`MATCHED (${why}) — ${r.deals.length} deal(s):`);
    for (const d of r.deals.slice(0, 4)) parts.push(dealCard(d, r.attention));
  } else if (r.mode === "list" || r.mode === "count") {
    parts.push(
      `MATCHED (${why}): ${fmtInt(r.matchedTotal)} deal(s) in total. ` +
        (r.deals.length < r.matchedTotal
          ? `Showing the ${r.deals.length} most urgent / recent:`
          : "All of them:"),
    );
    for (const d of r.deals) parts.push(dealRow(d));
  } else if (r.mode === "attention" || r.mode === "overview") {
    const crit = r.attention.filter((a) => a.severity === "critical");
    const warn = r.attention.filter((a) => a.severity === "warning");
    parts.push(`NEEDS ATTENTION (${why}): ${crit.length} critical, ${warn.length} warning items.`);
    for (const a of [...crit, ...warn].slice(0, 10)) {
      const ad = r.scope.find((d) => d.id === a.dealId);
      const href = ad ? dealHref(ad) : `/deals/${encodeURIComponent(a.dealId)}`;
      parts.push(`- (${a.severity}) [${a.dealCode}](${href}): ${a.title} → next: ${clip(a.nextStep, 120)}`);
    }
    parts.push("PRIORITY QUEUE (highest first):");
    for (const d of r.deals.slice(0, 10)) parts.push(dealRow(d));
  } else if (r.mode === "product") {
    parts.push(
      "PRODUCT QUESTION — answer from your product knowledge (Command Center, Finance, Operations, Deal Board, Mailbox book, Inbox, Document Vault, Supplier Hub, Agency commissions). Point to the exact page to click.",
    );
  }

  // Pack whole sections under budget; drop trailing deals rather than cutting text.
  let used = sections.join("\n\n").length + RULES.length + 200;
  const kept: string[] = [];
  let dropped = 0;
  for (const p of parts) {
    if (used + p.length + 2 > budget) {
      dropped += 1;
      continue;
    }
    kept.push(p);
    used += p.length + 2;
  }
  if (kept.length) sections.push(kept.join("\n"));
  if (dropped) sections.push(`(${dropped} more item(s) omitted for length — offer to narrow the question.)`);
  sections.push(RULES);
  return sections.join("\n\n");
}
