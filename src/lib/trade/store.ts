"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type {
  AgentRoutingMap,
  Deal,
  DealDocument,
  DealStage,
  OpsIntelCache,
  OutreachEnrollment,
  PartyProfile,
  QuoteMatrix,
  RequirementFields,
  SourceMessage,
  SupplierHubApplication,
  TimelineEvent,
} from "@/types/trade";
import { DEFAULT_ROUTING } from "@/types/trade";
import { formatDealCode } from "./dealCode";
import {
  applicationToPartyProfile,
  prepareApplicationForSubmit,
  submitValidationErrors,
} from "./supplierOnboarding";
import type { CommercialModelFilter } from "./commercialModel";
import type { DisplayCurrency } from "./currencyDisplay";
import { setDisplayCurrency as applyDisplayCurrency } from "./currencyDisplay";

export type StageFilter = "all" | DealStage;
export type ProductionDueFilter = "all" | 15 | 30 | 45 | 60 | 90;
export type MailboxBookStatus = "idle" | "loading" | "ready" | "error";

interface TradeState {
  deals: Deal[];
  routing: AgentRoutingMap;
  opsIntel: OpsIntelCache;
  partyProfiles: PartyProfile[];
  supplierApplications: SupplierHubApplication[];
  dealCodeSeq: number;
  /** Filter Command Center / boards by agency vs trader book */
  commercialModelFilter: CommercialModelFilter;
  setCommercialModelFilter: (filter: CommercialModelFilter) => void;
  /** Display currency for money formatting (amounts stored USD) */
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  /** Deal board stage filter */
  stageFilter: StageFilter;
  setStageFilter: (filter: StageFilter) => void;
  /** Production ready/due window (days) */
  productionDueFilter: ProductionDueFilter;
  setProductionDueFilter: (filter: ProductionDueFilter) => void;
  /** Free-text search: deal name, parties, emails, team mailboxes */
  dealsSearchQuery: string;
  setDealsSearchQuery: (query: string) => void;
  /** Live mailbox hydrate lifecycle — avoid flashing 0 KPIs before load */
  mailboxBookStatus: MailboxBookStatus;
  mailboxBookError: string | null;
  setMailboxBookStatus: (
    status: MailboxBookStatus,
    error?: string | null,
  ) => void;
  createDeal: (partial?: Partial<Deal>) => Deal;
  upsertDeal: (deal: Deal) => Deal;
  mergeMailboxDeals: (deals: Deal[]) => void;
  upsertPartyProfile: (profile: PartyProfile) => PartyProfile;
  saveSupplierApplication: (app: SupplierHubApplication) => SupplierHubApplication;
  getSupplierApplication: (id: string) => SupplierHubApplication | undefined;
  deleteSupplierApplication: (id: string) => void;
  /** Validates, scores, promotes to factory directory for recommendations */
  submitSupplierApplication: (
    id: string,
  ) =>
    | { ok: true; application: SupplierHubApplication; profile: PartyProfile }
    | { ok: false; errors: string[] };
  updateDeal: (id: string, patch: Partial<Deal>) => void;
  deleteDeal: (id: string) => void;
  getDeal: (id: string) => Deal | undefined;
  setStage: (id: string, stage: DealStage) => void;
  setRequirement: (
    id: string,
    requirement: RequirementFields,
    executionId?: string,
  ) => void;
  setQuote: (id: string, quote: QuoteMatrix) => void;
  toggleSku: (dealId: string, index: number, selected: boolean) => void;
  lockSelection: (dealId: string) => void;
  addDocument: (
    dealId: string,
    doc: Omit<DealDocument, "id" | "uploadedAt">,
  ) => void;
  addSource: (
    dealId: string,
    source: Omit<SourceMessage, "id"> & { id?: string },
  ) => void;
  addTimeline: (
    dealId: string,
    event: Omit<TimelineEvent, "id" | "at"> & { at?: string },
  ) => void;
  addOutreach: (
    dealId: string,
    enrollment: Omit<OutreachEnrollment, "id" | "enrolledAt">,
  ) => void;
  updateOutreach: (
    dealId: string,
    enrollmentId: string,
    patch: Partial<OutreachEnrollment>,
  ) => void;
  setRouting: (patch: Partial<AgentRoutingMap>) => void;
  setOpsIntel: (patch: Partial<OpsIntelCache>) => void;
}

function now() {
  return new Date().toISOString();
}

function normalizeDocs(
  docs: Array<Partial<DealDocument> & { name: string; type: DealDocument["type"] }> | undefined,
): DealDocument[] {
  return (docs || []).map((d) => {
    const samplePath = d.samplePath;
    const url =
      d.url ||
      (samplePath
        ? `/api/samples/${samplePath
            .replace(/^docs\/samples\//, "")
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/")}`
        : undefined);
    return {
      name: d.name,
      type: d.type,
      s3Key: d.s3Key,
      url,
      samplePath,
      extractedBy: d.extractedBy,
      extractedSummary: d.extractedSummary,
      id: d.id || uuid(),
      uploadedAt: d.uploadedAt || now(),
    };
  });
}

function normalizeSources(
  sources: Array<Partial<SourceMessage> & { kind: SourceMessage["kind"]; body: string }> | undefined,
): SourceMessage[] {
  return (sources || []).map((s) => ({
    id: s.id || uuid(),
    kind: s.kind,
    subject: s.subject,
    from: s.from,
    to: s.to,
    receivedAt: s.receivedAt,
    body: s.body,
    relatedDocumentId: s.relatedDocumentId,
    label: s.label,
    attachments: (s.attachments || []).map((a) => ({
      ...a,
      url:
        a.url ||
        (a.samplePath
          ? `/api/samples/${a.samplePath
              .replace(/^docs\/samples\//, "")
              .split("/")
              .map((seg) => encodeURIComponent(seg))
              .join("/")}`
          : undefined),
    })),
    extractedBy: s.extractedBy,
    extractedSummary: s.extractedSummary,
  }));
}

function isSyntheticDeal(deal: Pick<Deal, "id" | "portfolioSeed" | "showcase">) {
  return Boolean(
    deal.portfolioSeed ||
      deal.showcase ||
      deal.id.startsWith("bob-"),
  );
}

function ensureCode(
  partial: Partial<Deal> | undefined,
  seq: number,
): { code: string; nextSeq: number } {
  if (partial?.code) return { code: partial.code, nextSeq: seq };
  return { code: formatDealCode(seq), nextSeq: seq + 1 };
}

export const useTradeStore = create<TradeState>()(
  persist(
    (set, get) => ({
      deals: [],
      routing: { ...DEFAULT_ROUTING },
      opsIntel: {},
      partyProfiles: [],
      supplierApplications: [],
      dealCodeSeq: 1100,
      commercialModelFilter: "all" as CommercialModelFilter,
      setCommercialModelFilter: (filter) =>
        set({ commercialModelFilter: filter }),
      displayCurrency: "all" as DisplayCurrency,
      setDisplayCurrency: (currency) => {
        applyDisplayCurrency(currency);
        set({ displayCurrency: currency });
      },
      stageFilter: "all" as StageFilter,
      setStageFilter: (filter) => set({ stageFilter: filter }),
      productionDueFilter: "all" as ProductionDueFilter,
      setProductionDueFilter: (filter) =>
        set({ productionDueFilter: filter }),
      dealsSearchQuery: "",
      setDealsSearchQuery: (query) => set({ dealsSearchQuery: query }),
      mailboxBookStatus: "idle" as MailboxBookStatus,
      mailboxBookError: null as string | null,
      setMailboxBookStatus: (status, error = null) =>
        set({ mailboxBookStatus: status, mailboxBookError: error }),

      createDeal: (partial) => {
        const { code, nextSeq } = ensureCode(partial, get().dealCodeSeq);
        const deal: Deal = {
          id: partial?.id || uuid(),
          code,
          title: partial?.title || "Untitled deal",
          stage: partial?.stage || "requirement",
          createdAt: partial?.createdAt || now(),
          updatedAt: partial?.updatedAt || now(),
          parties: partial?.parties || [
            { role: "agency", name: "SNSPL", company: "Savvy Net Sourcing" },
          ],
          showcase: false,
          portfolioSeed: false,
          mailboxIngest: partial?.mailboxIngest,
          recommendedFactoryIds: partial?.recommendedFactoryIds,
          requirement: partial?.requirement,
          requirementExecutionId: partial?.requirementExecutionId,
          quote: partial?.quote,
          selectionLocked: partial?.selectionLocked,
          artwork: partial?.artwork,
          samples: partial?.samples,
          pi: partial?.pi,
          po: partial?.po,
          discrepancy: partial?.discrepancy,
          upcMatch: partial?.upcMatch,
          packaging: partial?.packaging,
          inspection: partial?.inspection,
          production: partial?.production,
          booking: partial?.booking,
          cbm: partial?.cbm,
          docsPack: partial?.docsPack,
          payment: partial?.payment,
          commission: partial?.commission,
          paymentSchedule: partial?.paymentSchedule,
          economics: partial?.economics,
          cashExposure: partial?.cashExposure,
          documents: normalizeDocs(
            (partial?.documents as DealDocument[] | undefined) || [],
          ),
          sources: normalizeSources(partial?.sources),
          timeline: (partial?.timeline || []).length
            ? (partial!.timeline || []).map((e) => ({
                ...e,
                id: e.id || uuid(),
                at: e.at || now(),
              }))
            : [
                {
                  id: uuid(),
                  at: now(),
                  channel: "portal" as const,
                  title: "Deal created",
                },
              ],
          outreach: (partial?.outreach || []).map((o) => ({
            ...o,
            id: o.id || uuid(),
            enrolledAt: o.enrolledAt || now(),
          })),
        };
        set((s) => ({
          dealCodeSeq: Math.max(s.dealCodeSeq, nextSeq),
          deals: s.deals.some((d) => d.id === deal.id)
            ? s.deals.map((d) => (d.id === deal.id ? deal : d))
            : [deal, ...s.deals],
        }));
        return deal;
      },

      upsertDeal: (deal) => {
        if (isSyntheticDeal(deal)) return deal;
        const withDefaults: Deal = {
          ...deal,
          code: deal.code || formatDealCode(get().dealCodeSeq),
          sources: deal.sources || [],
          showcase: false,
          portfolioSeed: false,
        };
        set((s) => ({
          deals: s.deals.some((d) => d.id === withDefaults.id)
            ? s.deals.map((d) => (d.id === withDefaults.id ? withDefaults : d))
            : [withDefaults, ...s.deals],
        }));
        return withDefaults;
      },

      mergeMailboxDeals: (incoming) => {
        set((s) => {
          const existingById = new Map(
            s.deals.filter((d) => d.mailboxIngest).map((d) => [d.id, d]),
          );
          const realIncoming = incoming
            .filter((d) => !isSyntheticDeal(d))
            .map((d) => {
              const prev = existingById.get(d.id);
              if (!prev) return d;
              // List hydrate omits evidence_json — keep richer sources already loaded.
              const prevSources = prev.sources?.length || 0;
              const nextSources = d.sources?.length || 0;
              const prevBody = (prev.sources || []).reduce(
                (n, src) => n + (src.body?.length || 0),
                0,
              );
              const nextBody = (d.sources || []).reduce(
                (n, src) => n + (src.body?.length || 0),
                0,
              );
              const keepPrevEvidence =
                prevSources > nextSources ||
                (prevSources > 0 && prevBody > nextBody);
              if (!keepPrevEvidence) return d;
              return {
                ...d,
                sources: prev.sources,
                documents:
                  (prev.documents?.length || 0) >= (d.documents?.length || 0)
                    ? prev.documents
                    : d.documents,
                timeline:
                  (prev.timeline?.length || 0) >= (d.timeline?.length || 0)
                    ? prev.timeline
                    : d.timeline,
                agentResult: d.agentResult || prev.agentResult,
                // Always prefer freshly mapped schedules/payment so KPI fixes land on refresh
                paymentSchedule: d.paymentSchedule || prev.paymentSchedule,
                payment: d.payment
                  ? { ...prev.payment, ...d.payment }
                  : prev.payment,
                booking: d.booking
                  ? { ...prev.booking, ...d.booking }
                  : prev.booking,
                commission: d.commission || prev.commission,
                cashExposure: d.cashExposure || prev.cashExposure,
                economics: d.economics || prev.economics,
              };
            });
          const keep = s.deals.filter(
            (d) => !d.mailboxIngest && !isSyntheticDeal(d),
          );
          return { deals: [...realIncoming, ...keep] };
        });
      },

      upsertPartyProfile: (profile) => {
        const list = get().partyProfiles;
        const idx = list.findIndex((p) => p.id === profile.id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = profile;
          set({ partyProfiles: next });
        } else {
          set({ partyProfiles: [...list, profile] });
        }
        return profile;
      },

      saveSupplierApplication: (app) => {
        const stamped = { ...app, updatedAt: now() };
        const list = get().supplierApplications;
        const idx = list.findIndex((a) => a.id === stamped.id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = stamped;
          set({ supplierApplications: next });
        } else {
          set({ supplierApplications: [...list, stamped] });
        }
        return stamped;
      },

      getSupplierApplication: (id) =>
        get().supplierApplications.find((a) => a.id === id),

      deleteSupplierApplication: (id) =>
        set((s) => ({
          supplierApplications: s.supplierApplications.filter((a) => a.id !== id),
        })),

      submitSupplierApplication: (id) => {
        const existing = get().getSupplierApplication(id);
        if (!existing) return { ok: false, errors: ["Application not found"] };
        const errors = submitValidationErrors(existing);
        if (errors.length) return { ok: false, errors };
        const prepared = prepareApplicationForSubmit(existing);
        const prior = prepared.profileId
          ? get().partyProfiles.find((p) => p.id === prepared.profileId)
          : undefined;
        const profile = applicationToPartyProfile(prepared, prior);
        const withProfile: SupplierHubApplication = {
          ...prepared,
          profileId: profile.id,
        };
        get().saveSupplierApplication(withProfile);
        get().upsertPartyProfile(profile);
        return { ok: true, application: withProfile, profile };
      },

      updateDeal: (id, patch) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: now() } : d,
          ),
        })),

      deleteDeal: (id) =>
        set((s) => ({ deals: s.deals.filter((d) => d.id !== id) })),

      getDeal: (id) => get().deals.find((d) => d.id === id),

      setStage: (id, stage) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === id
              ? {
                  ...d,
                  stage,
                  updatedAt: now(),
                  timeline: [
                    {
                      id: uuid(),
                      at: now(),
                      channel: "portal" as const,
                      title: `Stage → ${stage}`,
                    },
                    ...d.timeline,
                  ],
                }
              : d,
          ),
        })),

      setRequirement: (id, requirement, executionId) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === id
              ? {
                  ...d,
                  requirement,
                  requirementExecutionId: executionId,
                  title:
                    requirement.productCategory ||
                    requirement.summary?.slice(0, 60) ||
                    d.title,
                  stage: d.stage === "requirement" ? "outreach" : d.stage,
                  updatedAt: now(),
                  timeline: [
                    {
                      id: uuid(),
                      at: now(),
                      channel: "portal" as const,
                      title: "Requirement extracted",
                      detail: requirement.summary,
                      meta: {
                        executionId,
                        confidence: requirement.confidence,
                      },
                    },
                    ...d.timeline,
                  ],
                }
              : d,
          ),
        })),

      setQuote: (id, quote) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === id
              ? {
                  ...d,
                  quote,
                  stage: "quoting",
                  updatedAt: now(),
                  timeline: [
                    {
                      id: uuid(),
                      at: now(),
                      channel: "portal" as const,
                      title: "Quote matrix normalized",
                      detail: `${quote.skus.length} SKUs from ${quote.factoryName || "factory"}`,
                      meta: { executionId: quote.executionId },
                    },
                    ...d.timeline,
                  ],
                }
              : d,
          ),
        })),

      toggleSku: (dealId, index, selected) =>
        set((s) => ({
          deals: s.deals.map((d) => {
            if (d.id !== dealId || !d.quote) return d;
            const skus = d.quote.skus.map((sku, i) =>
              i === index ? { ...sku, selected } : sku,
            );
            return {
              ...d,
              quote: { ...d.quote, skus },
              stage: "selection",
              updatedAt: now(),
            };
          }),
        })),

      lockSelection: (dealId) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === dealId
              ? {
                  ...d,
                  selectionLocked: true,
                  stage: "selection",
                  updatedAt: now(),
                  timeline: [
                    {
                      id: uuid(),
                      at: now(),
                      channel: "portal" as const,
                      title: "Buyer selection locked",
                      detail: `${d.quote?.skus.filter((x) => x.selected).length || 0} SKUs selected`,
                    },
                    ...d.timeline,
                  ],
                }
              : d,
          ),
        })),

      addDocument: (dealId, doc) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === dealId
              ? {
                  ...d,
                  documents: [
                    { ...doc, id: uuid(), uploadedAt: now() },
                    ...d.documents,
                  ],
                  updatedAt: now(),
                }
              : d,
          ),
        })),

      addSource: (dealId, source) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === dealId
              ? {
                  ...d,
                  sources: [
                    ...normalizeSources([
                      {
                        ...source,
                        id: source.id || uuid(),
                        receivedAt: source.receivedAt || now(),
                      },
                    ]),
                    ...(d.sources || []),
                  ],
                  updatedAt: now(),
                }
              : d,
          ),
        })),

      addTimeline: (dealId, event) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === dealId
              ? {
                  ...d,
                  timeline: [
                    { id: uuid(), at: event.at || now(), ...event },
                    ...d.timeline,
                  ],
                  updatedAt: now(),
                }
              : d,
          ),
        })),

      addOutreach: (dealId, enrollment) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === dealId
              ? {
                  ...d,
                  outreach: [
                    { ...enrollment, id: uuid(), enrolledAt: now() },
                    ...d.outreach,
                  ],
                  stage: "outreach",
                  updatedAt: now(),
                  timeline: [
                    {
                      id: uuid(),
                      at: now(),
                      channel: enrollment.channel,
                      title: `Outreach enrolled: ${enrollment.factoryName}`,
                    },
                    ...d.timeline,
                  ],
                }
              : d,
          ),
        })),

      updateOutreach: (dealId, enrollmentId, patch) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === dealId
              ? {
                  ...d,
                  outreach: d.outreach.map((o) =>
                    o.id === enrollmentId ? { ...o, ...patch } : o,
                  ),
                  updatedAt: now(),
                }
              : d,
          ),
        })),

      setRouting: (patch) =>
        set((s) => ({ routing: { ...s.routing, ...patch } })),

      setOpsIntel: (patch) =>
        set((s) => ({ opsIntel: { ...s.opsIntel, ...patch } })),
    }),
    {
      // v3: wipe localStorage that still held demo portfolio / seed parties
      name: "vibrium-trade-store-v3",
      partialize: (s) => ({
        // Mailbox deals re-hydrate from API; never persist synthetic seeds.
        deals: s.deals.filter((d) => !d.mailboxIngest && !isSyntheticDeal(d)),
        routing: s.routing,
        opsIntel: s.opsIntel,
        // Only persist hub-onboarded / user-created parties (no demo directory).
        partyProfiles: s.partyProfiles.filter((p) =>
          Boolean(p.sourceApplicationId),
        ),
        supplierApplications: s.supplierApplications,
        dealCodeSeq: s.dealCodeSeq,
        commercialModelFilter: s.commercialModelFilter,
        displayCurrency: s.displayCurrency,
        stageFilter: s.stageFilter,
        productionDueFilter: s.productionDueFilter,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<TradeState>;
        const mergedRouting = {
          ...DEFAULT_ROUTING,
          ...(p.routing || {}),
        };
        for (const [k, v] of Object.entries(mergedRouting)) {
          if (!v && DEFAULT_ROUTING[k as keyof typeof DEFAULT_ROUTING]) {
            mergedRouting[k as keyof typeof mergedRouting] =
              DEFAULT_ROUTING[k as keyof typeof DEFAULT_ROUTING];
          }
        }
        // Bots that lived only on the shared Vibrium org.
        if (
          mergedRouting.ops_copilot === "VB00000323" ||
          mergedRouting.ops_copilot === "VB00000268"
        ) {
          mergedRouting.ops_copilot = DEFAULT_ROUTING.ops_copilot;
        }
        const deals = (p.deals || current.deals)
          .filter((d) => !isSyntheticDeal(d))
          .map((d) => ({
            ...d,
            code: d.code || formatDealCode(1100),
            showcase: false,
            portfolioSeed: false,
            sources: normalizeSources(d.sources || []),
            documents: normalizeDocs(d.documents || []),
          }));
        const partyProfiles = (
          p.partyProfiles ||
          current.partyProfiles ||
          []
        ).filter((profile) => Boolean(profile.sourceApplicationId));
        return {
          ...current,
          ...p,
          routing: mergedRouting,
          deals,
          partyProfiles,
          supplierApplications: p.supplierApplications || current.supplierApplications || [],
          opsIntel: { ...current.opsIntel, ...(p.opsIntel || {}) },
          dealCodeSeq: p.dealCodeSeq || current.dealCodeSeq,
          commercialModelFilter:
            p.commercialModelFilter === "agency_commission" ||
            p.commercialModelFilter === "trader_principal" ||
            p.commercialModelFilter === "all"
              ? p.commercialModelFilter
              : current.commercialModelFilter,
          displayCurrency:
            p.displayCurrency === "INR" ||
            p.displayCurrency === "USD" ||
            p.displayCurrency === "all"
              ? p.displayCurrency
              : current.displayCurrency,
          stageFilter: (p.stageFilter as StageFilter) || current.stageFilter,
          productionDueFilter:
            (p.productionDueFilter as ProductionDueFilter) ||
            current.productionDueFilter,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.displayCurrency) {
          applyDisplayCurrency(state.displayCurrency);
        }
      },
    },
  ),
);
