import type {
  BookingDetails,
  CommercialDocument,
  Deal,
  DealStage,
  DocumentType,
  Party,
  PaymentClock,
  QuoteMatrix,
  RequirementFields,
  SourceMessage,
  SourceMessageKind,
} from "@/types/trade";
import { ingestFileOpenUrl } from "./ingestFiles";

export type ProcessedDealRow = {
  id: string;
  po_numbers?: string[] | null;
  subject?: string | null;
  primary_stage?: string | null;
  slot?: string | null;
  agent_id?: string | null;
  status?: string | null;
  summary?: string | null;
  confidence?: number | null;
  date_start?: string | null;
  date_end?: string | null;
  message_count?: number | null;
  doc_count?: number | null;
  parties_json?: {
    buyers?: string[];
    buyer?: string[];
    factories?: string[];
    factory?: string[];
    traders?: string[];
    trader?: string[];
  } | null;
  error?: string | null;
  processed_at?: string | null;
  result_json?: Record<string, unknown> | null;
  cost_usd?: number | null;
  commercial_model?: string | null;
  evidence_json?: EvidencePayload | null;
  document?: string | null;
  document_name?: string | null;
  document_url?: string | null;
};

export type EvidenceMessage = {
  id?: string;
  subject?: string;
  from?: string;
  from_name?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  date?: string;
  body?: string;
  attachments?: { name?: string; url?: string; path?: string }[];
};

export type EvidencePayload = {
  commercial_model?: string;
  slot?: string;
  email_text?: string;
  document_name?: string;
  document_url?: string;
  messages?: EvidenceMessage[];
  message_count?: number;
  doc_count?: number;
};

const STAGE_MAP: Record<string, DealStage> = {
  requirement: "requirement",
  quoting: "quoting",
  artwork: "artwork",
  samples: "samples",
  pi_po: "pi_po",
  inspection: "production",
  booking: "booking",
  payment: "docs_payment",
  other: "requirement",
};

const SOURCE_KIND: Record<string, SourceMessageKind> = {
  requirement_extractor: "requirement",
  quote_normalizer: "quote",
  artwork_checklist_extractor: "artwork",
  sample_request_summarizer: "samples",
  pi_extractor: "pi",
  po_extractor: "po",
  inspection_photo_summarizer: "inspection",
  booking_extractor: "booking",
  payment_clock: "payment",
  commission_checklist: "commission",
  final_docs_pack_check: "booking",
};

const DOC_TYPE: Record<string, DocumentType> = {
  quote_normalizer: "quote",
  pi_extractor: "pi",
  po_extractor: "po",
  booking_extractor: "booking",
  payment_clock: "commercial_invoice",
  requirement_extractor: "rfq",
};

const PAYMENT_STATUS = new Set<PaymentClock["status"]>([
  "not_started",
  "pending",
  "due_soon",
  "overdue",
  "paid",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asResult(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asResult(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
    return asRecord(first);
  }
  return asRecord(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toUsd(amount: number, currency?: string): number {
  const c = (currency || "USD").toUpperCase();
  if (c === "INR") return amount / 83;
  if (c === "EUR") return amount * 1.08;
  if (c === "GBP") return amount * 1.27;
  return amount;
}

function moneyFromText(text: string): number | undefined {
  const match = text.match(
    /\b(USD|INR|EUR|GBP|\$)\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (!match) return undefined;
  const amount = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  const cur = match[1] === "$" ? "USD" : match[1].toUpperCase();
  return toUsd(amount, cur);
}

function slugId(id: string) {
  const slug = id
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100);
  return `mb-${slug || "deal"}`;
}

function dealCode(row: ProcessedDealRow): string {
  const po = row.po_numbers?.find(Boolean);
  if (po) return `PO-${String(po).replace(/\s+/g, "").slice(0, 12)}`;
  const slug = (row.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-8)
    .toUpperCase();
  return `MB-${slug || "DEAL"}`;
}

function parties(row: ProcessedDealRow, result: Record<string, unknown>): Party[] {
  const json = row.parties_json || {};
  const buyers = json.buyers || json.buyer || [];
  const factories = json.factories || json.factory || [];
  const traders = json.traders || json.trader || [];
  const model =
    row.commercial_model ||
    str(result.commercialModel) ||
    "agency_commission";
  const out: Party[] = [
    {
      role: model === "trader_principal" ? "trader" : "agency",
      name: model === "trader_principal" ? "Global Praise" : "SNSPL",
      company:
        model === "trader_principal"
          ? "Global Praise Limited"
          : "Savvy Net Sourcing",
    },
  ];
  const buyerName =
    str(result.buyerCompany) ||
    str(result.buyer) ||
    str(result.consignee) ||
    buyers[0];
  if (buyerName) out.push({ role: "buyer", name: buyerName, company: buyerName });
  const factoryName =
    str(result.factory) ||
    str(result.factoryName) ||
    str(result.shipper) ||
    factories[0];
  if (factoryName)
    out.push({ role: "factory", name: factoryName, company: factoryName });
  for (const t of traders) {
    if (t && !out.some((p) => p.name === t)) {
      out.push({ role: "trader", name: t, company: t });
    }
  }
  return out;
}

function evidenceFrom(row: ProcessedDealRow): EvidencePayload {
  const raw = row.evidence_json;
  if (raw && typeof raw === "object") return raw as EvidencePayload;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EvidencePayload;
    } catch {
      return {};
    }
  }
  return {};
}

function joinAddrs(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(", ");
    return joined || undefined;
  }
  return String(value);
}

function resolveAttachmentUrl(
  a: { name?: string; url?: string; path?: string },
  primaryUrl?: string,
  primaryName?: string,
): string | undefined {
  if (a.url) return a.url;
  const isPrimary = Boolean(primaryName) && a.name === primaryName;
  if (isPrimary && primaryUrl) return primaryUrl;
  return ingestFileOpenUrl({ path: a.path, name: a.name, url: a.url });
}

function buildSources(
  row: ProcessedDealRow,
  result: Record<string, unknown>,
  summary: string,
  slot: string,
  kind: SourceMessageKind,
  fullEvidence = false,
): SourceMessage[] {
  const evidence = evidenceFrom(row);
  const messages = evidence.messages || [];
  const extractedBy = slot || undefined;
  const extractedSummary = summary.slice(0, 280);
  const bodyLimit = fullEvidence ? 50_000 : 1_200;
  const primaryUrl = evidence.document_url || row.document_url || undefined;
  const primaryName = evidence.document_name || row.document_name || row.document || undefined;

  if (messages.length > 0) {
    return messages.map((m, i) => {
      const body = (m.body || "").trim();
      const preview =
        !fullEvidence && body.length > bodyLimit
          ? `${body.slice(0, bodyLimit)}\n\n[truncated — open View source after evidence load for full mail]`
          : body;
      return {
        id: `${row.id}-msg-${m.id || i}`,
        kind: i === 0 ? kind : "other",
        subject: m.subject || row.subject || undefined,
        from: m.from_name
          ? `${m.from_name} <${m.from || ""}>`
          : m.from || undefined,
        to: joinAddrs(m.to),
        cc: joinAddrs(m.cc),
        bcc: joinAddrs(m.bcc),
        receivedAt: m.date || row.date_end || row.processed_at || undefined,
        body: preview || summary,
        label: m.subject || `Message ${i + 1}`,
        attachments: (m.attachments || [])
          .filter((a) => a?.name)
          .map((a) => {
            const isPrimary =
              Boolean(primaryName) && a.name === primaryName;
            return {
              name: a.name!,
              url: resolveAttachmentUrl(a, primaryUrl, primaryName),
              samplePath: a.path || undefined,
              extractedBy: isPrimary ? extractedBy : undefined,
              extractedSummary: isPrimary ? extractedSummary : undefined,
            };
          }),
        extractedBy: i === 0 ? extractedBy : undefined,
        extractedSummary: i === 0 ? extractedSummary : undefined,
      };
    });
  }

  const emailText = (evidence.email_text || "").trim();
  const body =
    emailText ||
    (str(result.summary) ? `Agent summary:\n${summary}` : summary);
  const attachments =
    primaryName || primaryUrl
      ? [
          {
            name: primaryName || "attachment",
            url:
              primaryUrl ||
              ingestFileOpenUrl({ name: primaryName, url: primaryUrl }),
            extractedBy,
            extractedSummary,
          },
        ]
      : undefined;

  return [
    {
      id: `${row.id}-src`,
      kind,
      subject: row.subject || undefined,
      receivedAt: row.date_end || row.processed_at || undefined,
      body: body.slice(0, fullEvidence ? 50_000 : 16_000),
      label: row.subject || "Mailbox thread",
      attachments,
      extractedBy,
      extractedSummary,
    },
  ];
}

function buildTimelineFromSources(
  row: ProcessedDealRow,
  sources: SourceMessage[],
  summary: string,
  updated: string,
): Deal["timeline"] {
  if (sources.length === 0) {
    return [
      {
        id: `${row.id}-tl`,
        at: updated,
        channel: "email",
        title:
          row.status === "completed" ? "Mailbox extracted" : "Mailbox ingest",
        detail: summary.slice(0, 280),
      },
    ];
  }
  const created = sources
    .map((s) => ({
      id: `${s.id}-tl`,
      at: s.receivedAt || updated,
      channel: "email" as const,
      title: s.subject || s.label || "Mailbox message",
      detail: [
        s.from ? `From ${s.from}` : null,
        s.cc ? `Cc ${s.cc}` : null,
        (s.body || "").replace(/\s+/g, " ").slice(0, 160) || null,
      ]
        .filter(Boolean)
        .join(" · "),
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // Cap very long threads for the timeline UI
  if (created.length <= 40) return created;
  const head = created.slice(0, 12);
  const mid = created.slice(
    Math.floor(created.length / 2) - 4,
    Math.floor(created.length / 2) + 4,
  );
  const tail = created.slice(-16);
  const seen = new Set<string>();
  return [...head, ...mid, ...tail].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

function commercialFrom(
  result: Record<string, unknown>,
  docType: "pi" | "po",
  executionId?: string,
): CommercialDocument {
  const currency = str(result.currency) || "USD";
  const total = num(result.totalAmount);
  const lines = Array.isArray(result.lines)
    ? result.lines.map((line) => {
        const item = asRecord(line);
        return {
          description: str(item.description),
          qty: num(item.qty),
          unitPrice: num(item.unitPrice),
          amount: num(item.amount),
          itemCode: str(item.itemCode),
          cbm: num(item.cbm),
          packing: str(item.packing),
        };
      })
    : [];
  return {
    docType,
    docNumber: str(result.docNumber),
    shipper: str(result.shipper),
    consignee: str(result.consignee),
    buyer: str(result.buyer),
    factory: str(result.factory),
    incoterm: str(result.incoterm),
    paymentTerms: str(result.paymentTerms),
    pol: str(result.pol),
    pod: str(result.pod),
    currency,
    totalAmount: total != null ? toUsd(total, currency) : undefined,
    totalCbm: num(result.totalCbm),
    readyDate: str(result.readyDate),
    lines,
    summary: str(result.summary),
    confidence: num(result.confidence),
    executionId,
  };
}

export function mapProcessedDeal(
  row: ProcessedDealRow,
  opts?: { fullEvidence?: boolean },
): Deal | null {
  if (!row.id) return null;
  const result = asResult(row.result_json);
  const slot = row.slot || "";
  const stage = STAGE_MAP[row.primary_stage || ""] || "requirement";
  const created = row.date_start || row.processed_at || new Date().toISOString();
  const updated = row.date_end || row.processed_at || created;
  const summary =
    str(row.summary) || str(result.summary) || row.subject || "Mailbox deal";
  const executionId = row.agent_id || undefined;
  const kind = SOURCE_KIND[slot] || "other";
  const currency = str(result.currency);
  const extractedAmount =
    num(result.amountUsd) ??
    (num(result.totalAmount) != null
      ? toUsd(num(result.totalAmount)!, currency)
      : undefined) ??
    moneyFromText(summary);

  const evidence = evidenceFrom(row);
  const sources = buildSources(
    row,
    result,
    summary,
    slot,
    kind,
    Boolean(opts?.fullEvidence),
  );
  const betterTitle =
    str(result.summary)?.slice(0, 140) ||
    (row.subject || row.id).slice(0, 140);

  const deal: Deal = {
    id: slugId(row.id),
    code: dealCode(row),
    title: betterTitle,
    stage,
    createdAt: created,
    updatedAt: updated,
    mailboxIngest: true,
    mailboxSourceId: row.id,
    mailboxSlot: slot || undefined,
    commercialModel:
      row.commercial_model === "trader_principal"
        ? "trader_principal"
        : row.commercial_model === "agency_commission"
          ? "agency_commission"
          : str(result.commercialModel) === "trader_principal"
            ? "trader_principal"
            : "agency_commission",
    agentResult: Object.keys(result).length ? result : undefined,
    parties: parties(row, result),
    documents:
      evidence.document_name ||
      row.document_name ||
      row.document ||
      (row.doc_count || 0) > 0
        ? [
            {
              id: `${row.id}-doc`,
              name:
                evidence.document_name ||
                row.document_name ||
                row.document ||
                `${slot || "mailbox"} attachment`,
              type: DOC_TYPE[slot] || "other",
              uploadedAt: updated,
              url:
                evidence.document_url ||
                row.document_url ||
                ingestFileOpenUrl({
                  name:
                    evidence.document_name ||
                    row.document_name ||
                    row.document,
                  url: evidence.document_url || row.document_url,
                }),
              extractedBy: slot || undefined,
              extractedSummary: summary.slice(0, 220),
            },
          ]
        : [],
    sources,
    timeline: buildTimelineFromSources(row, sources, summary, updated),
    outreach: [],
  };

  if (slot === "requirement_extractor" || stage === "requirement") {
    const req: RequirementFields = {
      productCategory: str(result.productCategory),
      materials: str(result.materials),
      targetFactoryCost: num(result.targetFactoryCost),
      currency: str(result.currency),
      destination: str(result.destination),
      buyerCompany: str(result.buyerCompany),
      buyerContacts: Array.isArray(result.buyerContacts)
        ? result.buyerContacts.filter((x): x is string => typeof x === "string")
        : undefined,
      urgency: str(result.urgency),
      currentSourcingNotes: str(result.currentSourcingNotes),
      packingRequirements: str(result.packingRequirements),
      complianceNotes: str(result.complianceNotes),
      openQuestions: Array.isArray(result.openQuestions)
        ? result.openQuestions.filter((x): x is string => typeof x === "string")
        : undefined,
      nextActions: Array.isArray(result.nextActions)
        ? result.nextActions.filter((x): x is string => typeof x === "string")
        : undefined,
      subject: str(result.subject) || row.subject || undefined,
      summary,
      confidence: num(result.confidence) ?? row.confidence ?? undefined,
    };
    deal.requirement = req;
  }

  if (slot === "quote_normalizer") {
    const quote: QuoteMatrix = {
      factoryName: str(result.factoryName),
      currency: str(result.currency),
      quoteDate: str(result.quoteDate),
      incoterm: str(result.incoterm),
      paymentTerms: str(result.paymentTerms),
      leadTimeDays: num(result.leadTimeDays),
      notes: str(result.notes) || summary,
      confidence: num(result.confidence),
      skus: Array.isArray(result.skus)
        ? result.skus.map((sku) => {
            const item = asRecord(sku);
            return {
              itemCode: str(item.itemCode),
              description: str(item.description),
              moq: num(item.moq),
              unitPrice: num(item.unitPrice),
              currency: str(item.currency) || str(result.currency),
              packingNotes: str(item.packingNotes),
              selected: true,
            };
          })
        : [],
      executionId,
    };
    deal.quote = quote;
  }

  if (slot === "pi_extractor") {
    deal.pi = commercialFrom(result, "pi", executionId);
  }
  if (slot === "po_extractor") {
    deal.po = commercialFrom(result, "po", executionId);
  }

  if (slot === "booking_extractor") {
    const booking: BookingDetails = {
      bookingNumber: str(result.bookingNumber),
      carrier: str(result.carrier),
      vessel: str(result.vessel),
      voyage: str(result.voyage),
      pol: str(result.pol),
      pod: str(result.pod),
      etd: str(result.etd),
      eta: str(result.eta),
      equipment: str(result.equipment),
      cutOffs: str(result.cutOffs),
      summary,
      confidence: num(result.confidence),
      executionId,
    };
    const etd = booking.etd ? Date.parse(booking.etd) : NaN;
    const eta = booking.eta ? Date.parse(booking.eta) : NaN;
    const now = Date.now();
    if (!Number.isNaN(etd) && etd < now && !Number.isNaN(eta) && eta > now) {
      booking.shipmentStatus = "in_waters";
    } else if (!Number.isNaN(etd) && etd >= now) {
      booking.shipmentStatus = "about_to_sail";
    } else if (!Number.isNaN(eta) && eta <= now) {
      booking.shipmentStatus = "arrived";
    }
    deal.booking = booking;
  }

  if (slot === "final_docs_pack_check") {
    const asStringList = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((x): x is string => typeof x === "string")
        : [];
    deal.docsPack = {
      required: asStringList(result.required),
      present: asStringList(result.present),
      missing: asStringList(result.missing),
      complete: Boolean(result.complete),
      summary,
      confidence: num(result.confidence),
      executionId,
    };
    // Surface logistics fields on booking when present
    if (
      str(result.vessel) ||
      str(result.pol) ||
      str(result.pod) ||
      str(result.container)
    ) {
      deal.booking = {
        ...(deal.booking || {}),
        vessel: str(result.vessel),
        pol: str(result.pol),
        pod: str(result.pod),
        etd: str(result.etd),
        eta: str(result.eta),
        equipment: str(result.container),
        summary,
        confidence: num(result.confidence),
        executionId,
      };
    }
  }

  if (slot === "payment_clock") {
    const rawStatus = str(result.status)?.toLowerCase() || "pending";
    const status = PAYMENT_STATUS.has(rawStatus as PaymentClock["status"])
      ? (rawStatus as PaymentClock["status"])
      : "pending";
    deal.payment = {
      blSharedDate: str(result.blSharedDate),
      dueDate: str(result.dueDate),
      daysRemaining: num(result.daysRemaining),
      status,
      amountUsd: extractedAmount,
      currency: str(result.currency) || "USD",
      summary,
      confidence: num(result.confidence),
      executionId,
    };
  }

  if (extractedAmount && extractedAmount > 0) {
    const paid = deal.payment?.status === "paid";
    deal.economics = {
      commercialValueUsd: extractedAmount,
      agencyCommissionUsd: extractedAmount * 0.05,
      cycleDaysTypical: 60,
      cycleDaysElapsed: Math.max(
        1,
        Math.floor((Date.now() - Date.parse(created)) / 86400000),
      ),
      commercialCashAtRiskUsd: deal.payment?.status === "overdue" ? extractedAmount : 0,
      agencyCashAtRiskUsd: 0,
      agencyInflowNext14dUsd: paid ? 0 : extractedAmount * 0.05,
      riskRewardRatio: 1,
      affordability: "comfortable",
      liquidityNote: summary.slice(0, 160),
      sources: [],
      summary,
    };
    deal.paymentSchedule = inferSchedule(deal, extractedAmount, paid);
    const deployed =
      paid || deal.stage === "docs_payment" || deal.stage === "booking"
        ? extractedAmount
        : Math.round(extractedAmount * 0.3);
    deal.cashExposure = {
      pipelineCommitmentUsd: extractedAmount,
      cashDeployedUsd: deployed,
      cashStillRequiredUsd: Math.max(0, extractedAmount - deployed),
      receivableExpectedUsd: paid ? 0 : extractedAmount,
      receivableDueDate: deal.payment?.dueDate,
      receivableStatus: paid
        ? "collected"
        : deal.payment?.status === "overdue"
          ? "overdue"
          : "expected",
      blockedAt:
        deal.stage === "booking"
          ? "transit"
          : deal.stage === "docs_payment"
            ? paid
              ? "none"
              : "buyer"
            : "vendor",
      sources: [],
    };
  }

  return deal;
}

function isoDay(value?: string, fallback?: string) {
  const raw = value || fallback || new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function inferSchedule(
  deal: Deal,
  amount: number,
  paid: boolean,
): Deal["paymentSchedule"] {
  const model = deal.commercialModel || "agency_commission";
  const buyerAmount = deal.po?.totalAmount || amount;
  const factoryAmount =
    deal.pi?.totalAmount ||
    (model === "trader_principal" ? Math.round(amount * 0.88) : undefined);
  const buyerTerms =
    deal.po?.paymentTerms ||
    "30% on PO acknowledgement · 70% T/T against B/L (default when PO terms blank)";
  const factoryTerms = deal.pi?.paymentTerms
    ? deal.pi.paymentTerms
    : factoryAmount != null
      ? "30% advance on PI · 70% against shipping docs (default when PI terms blank)"
      : "Factory PI not extracted yet — payable unknown (agency uses buyer PO for commercial reference only)";

  const start = isoDay(deal.createdAt);
  const due = isoDay(deal.payment?.dueDate, deal.updatedAt);
  const hasPaymentMail = (deal.sources || []).some((s) =>
    ["payment", "commission"].includes(s.kind),
  );
  // Only treat remittance as received when payment clock says paid or payment mail exists.
  // Do NOT mirror stage=booking into both sides — that was cloning buyer/factory totals incorrectly.
  // Past-due open installments must be "overdue" (not stuck as "upcoming") so Finance KPIs match the grid.
  const openStatus = (
    dueDate: string,
  ): "upcoming" | "due" | "overdue" => {
    const dueMs = Date.parse(`${dueDate}T12:00:00`);
    if (Number.isNaN(dueMs)) {
      return deal.payment?.status === "overdue" ? "overdue" : "upcoming";
    }
    const days = Math.round((Date.now() - dueMs) / 86400000);
    if (days > 0 || deal.payment?.status === "overdue") return "overdue";
    if (days === 0 || deal.payment?.status === "due_soon") return "due";
    return "upcoming";
  };
  const buyerAdvanceStatus: "received" | "upcoming" | "due" | "overdue" =
    paid || hasPaymentMail ? "received" : openStatus(start);
  const buyerBalanceStatus: "received" | "upcoming" | "due" | "overdue" = paid
    ? "received"
    : openStatus(due);

  const buyerAdvance = Math.round(buyerAmount * 0.3);
  const buyerBalance = Math.max(0, Math.round(buyerAmount - buyerAdvance));

  const checkpoints: NonNullable<Deal["paymentSchedule"]>["checkpoints"] = [
    {
      id: `${deal.id}-b1`,
      side: "buyer",
      label: "Buyer advance 30%",
      percent: 30,
      amountUsd: buyerAdvance,
      dueDate: start,
      status: buyerAdvanceStatus,
      receivedAt: buyerAdvanceStatus === "received" ? start : undefined,
      checkpoint: "PO acknowledgement",
      confirmationSourceId: (deal.sources || []).find((s) =>
        ["po", "payment"].includes(s.kind),
      )?.id,
      sourceIds: (deal.sources || [])
        .filter((s) => ["po", "payment"].includes(s.kind))
        .map((s) => s.id)
        .slice(0, 4),
    },
    {
      id: `${deal.id}-b2`,
      side: "buyer",
      label: "Buyer balance 70%",
      percent: 70,
      amountUsd: buyerBalance,
      dueDate: due,
      status: buyerBalanceStatus,
      receivedAt: buyerBalanceStatus === "received" ? due : undefined,
      checkpoint: "BL copy / payment clock",
      confirmationSourceId: (deal.sources || []).find((s) =>
        ["payment", "booking"].includes(s.kind),
      )?.id,
      sourceIds: (deal.sources || [])
        .filter((s) => ["payment", "booking"].includes(s.kind))
        .map((s) => s.id)
        .slice(0, 4),
    },
  ];

  if (factoryAmount != null && factoryAmount > 0) {
    const factoryAdvance = Math.round(factoryAmount * 0.3);
    const factoryBalance = Math.max(
      0,
      Math.round(factoryAmount - factoryAdvance),
    );
    // Factory remittances are separate from buyer receipts (especially agency).
    const factoryAdvanceStatus: "received" | "upcoming" | "due" | "overdue" =
      paid ? "received" : openStatus(start);
    const factoryBalanceStatus: "received" | "upcoming" | "due" | "overdue" =
      paid ? "received" : openStatus(due);
    checkpoints.unshift(
      {
        id: `${deal.id}-f1`,
        side: "factory",
        label: "Factory advance 30%",
        percent: 30,
        amountUsd: factoryAdvance,
        dueDate: start,
        status: factoryAdvanceStatus,
        receivedAt: factoryAdvanceStatus === "received" ? start : undefined,
        checkpoint: "PI locked",
        confirmationSourceId: (deal.sources || []).find((s) =>
          ["pi", "payment"].includes(s.kind),
        )?.id,
        sourceIds: (deal.sources || [])
          .filter((s) => ["pi", "payment"].includes(s.kind))
          .map((s) => s.id)
          .slice(0, 4),
      },
      {
        id: `${deal.id}-f2`,
        side: "factory",
        label: "Factory balance 70%",
        percent: 70,
        amountUsd: factoryBalance,
        dueDate: due,
        status: factoryBalanceStatus,
        receivedAt: factoryBalanceStatus === "received" ? due : undefined,
        checkpoint: "Shipping docs / BL",
        confirmationSourceId: (deal.sources || []).find((s) =>
          ["payment", "booking"].includes(s.kind),
        )?.id,
        sourceIds: (deal.sources || [])
          .filter((s) => ["payment", "booking"].includes(s.kind))
          .map((s) => s.id)
          .slice(0, 4),
      },
    );
  }

  return {
    buyerTerms,
    factoryTerms,
    currency:
      deal.payment?.currency ||
      deal.po?.currency ||
      deal.pi?.currency ||
      "USD",
    orderValueUsd: buyerAmount,
    checkpoints,
  };
}
