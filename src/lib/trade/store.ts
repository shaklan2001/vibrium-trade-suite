"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type {
  AgentRoutingMap,
  Deal,
  DealDocument,
  DealStage,
  OutreachEnrollment,
  QuoteMatrix,
  RequirementFields,
  TimelineEvent,
} from "@/types/trade";
import { DEFAULT_ROUTING } from "@/types/trade";

interface TradeState {
  deals: Deal[];
  routing: AgentRoutingMap;
  createDeal: (partial?: Partial<Deal>) => Deal;
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
  addDocument: (dealId: string, doc: Omit<DealDocument, "id" | "uploadedAt">) => void;
  addTimeline: (
    dealId: string,
    event: Omit<TimelineEvent, "id" | "at"> & { at?: string },
  ) => void;
  addOutreach: (dealId: string, enrollment: Omit<OutreachEnrollment, "id" | "enrolledAt">) => void;
  updateOutreach: (
    dealId: string,
    enrollmentId: string,
    patch: Partial<OutreachEnrollment>,
  ) => void;
  setRouting: (patch: Partial<AgentRoutingMap>) => void;
}

function now() {
  return new Date().toISOString();
}

export const useTradeStore = create<TradeState>()(
  persist(
    (set, get) => ({
      deals: [],
      routing: { ...DEFAULT_ROUTING },

      createDeal: (partial) => {
        const deal: Deal = {
          id: uuid(),
          title: partial?.title || "Untitled deal",
          stage: partial?.stage || "requirement",
          createdAt: now(),
          updatedAt: now(),
          parties: partial?.parties || [
            { role: "agency", name: "SNSPL", company: "Savvy Net Sourcing" },
          ],
          documents: [],
          timeline: [
            {
              id: uuid(),
              at: now(),
              channel: "portal",
              title: "Deal created",
            },
          ],
          outreach: [],
          ...partial,
        };
        set((s) => ({ deals: [deal, ...s.deals] }));
        return deal;
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
                      meta: { executionId, confidence: requirement.confidence },
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
    }),
    {
      name: "vibrium-trade-store-v1",
      partialize: (s) => ({ deals: s.deals, routing: s.routing }),
    },
  ),
);
