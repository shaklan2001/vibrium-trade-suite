import type {
  AgentRoutingMap,
  Deal,
  PartyProfile,
  SupplierHubApplication,
} from "@/types/trade";

/** localStorage is ~5 MB. Mailbox deals live in IndexedDB; ops intel is rebuilt. */
const BODY_CAP = 32_000;

type SnapshotInput = {
  deals: Deal[];
  routing: AgentRoutingMap;
  partyProfiles: PartyProfile[];
  supplierApplications: SupplierHubApplication[];
  dealCodeSeq: number;
  commercialModelFilter: string;
  displayCurrency: string;
  stageFilter: string;
  productionDueFilter: string | number;
};

export type QuotaStorage = {
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function isLocalDeal(
  deal: Pick<
    Deal,
    "id" | "portfolioSeed" | "showcase" | "mailboxIngest" | "mailboxSourceId"
  >,
): boolean {
  if (deal.portfolioSeed || deal.showcase || deal.id.startsWith("bob-")) {
    return false;
  }
  if (deal.mailboxIngest || deal.mailboxSourceId || deal.id.startsWith("mb-")) {
    return false;
  }
  return true;
}

/** Old snapshots stored mailbox rows without the flag. Tag them so hydrate replaces them. */
export function markRehydratedDeal<T extends Deal>(deal: T): T {
  if (deal.mailboxIngest || deal.mailboxSourceId || deal.id.startsWith("mb-")) {
    return { ...deal, mailboxIngest: true };
  }
  return deal;
}

function publicUrl(url?: string) {
  if (!url || url.startsWith("data:")) return undefined;
  return url;
}

export function dealForStorage(deal: Deal): Deal {
  return {
    ...deal,
    agentResult: undefined,
    searchText: undefined,
    docNotes: undefined,
    paymentNotes: undefined,
    sources: (deal.sources || []).map((source) => ({
      ...source,
      body:
        source.body.length > BODY_CAP
          ? source.body.slice(0, BODY_CAP)
          : source.body,
      attachments: (source.attachments || []).map((attachment) => ({
        ...attachment,
        url: publicUrl(attachment.url),
      })),
    })),
    documents: (deal.documents || []).map((doc) => ({
      ...doc,
      url: publicUrl(doc.url),
    })),
  };
}

export function snapshotForStorage(state: SnapshotInput) {
  return {
    deals: state.deals.filter(isLocalDeal).map(dealForStorage),
    routing: state.routing,
    partyProfiles: state.partyProfiles.filter((profile) =>
      Boolean(profile.sourceApplicationId),
    ),
    supplierApplications: state.supplierApplications,
    dealCodeSeq: state.dealCodeSeq,
    commercialModelFilter: state.commercialModelFilter,
    displayCurrency: state.displayCurrency,
    stageFilter: state.stageFilter,
    productionDueFilter: state.productionDueFilter,
  };
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: number }).code;
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22
  );
}

function readEnvelope(raw: string): { state: Record<string, unknown>; version: number } | null {
  try {
    const parsed = JSON.parse(raw) as {
      state?: Record<string, unknown>;
      version?: number;
    };
    if (!parsed?.state || typeof parsed.state !== "object") return null;
    return { state: parsed.state, version: parsed.version ?? 0 };
  } catch (err) {
    console.warn("[trade-store] persist payload was not JSON", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function pack(state: Record<string, unknown>, version: number) {
  return JSON.stringify({ state, version });
}

function smallerPayloads(raw: string): string[] {
  const envelope = readEnvelope(raw);
  if (!envelope) return [];
  const { state, version } = envelope;
  const deals = Array.isArray(state.deals) ? state.deals : [];
  const strippedDeals = deals.map((deal) => {
    const row = deal as Deal;
    return {
      ...row,
      sources: [],
      documents: [],
      agentResult: undefined,
      searchText: undefined,
      docNotes: undefined,
      paymentNotes: undefined,
    };
  });
  return [
    pack({ ...state, opsIntel: undefined, deals: strippedDeals }, version),
    pack({ ...state, opsIntel: undefined, deals: [] }, version),
    pack(
      {
        routing: state.routing,
        dealCodeSeq: state.dealCodeSeq,
        commercialModelFilter: state.commercialModelFilter,
        displayCurrency: state.displayCurrency,
        stageFilter: state.stageFilter,
        productionDueFilter: state.productionDueFilter,
        deals: [],
        partyProfiles: [],
        supplierApplications: [],
      },
      version,
    ),
  ];
}

/**
 * Writes the snapshot. On quota, drops the old key and retries with less deal
 * data. Never throws QuotaExceededError — that exception was crashing the UI.
 */
export function writeWithQuota(storage: QuotaStorage, key: string, value: string): void {
  const payloads = [value, ...smallerPayloads(value)];
  let last: unknown;
  for (let attempt = 0; attempt < payloads.length; attempt++) {
    if (attempt > 0) storage.removeItem(key);
    try {
      storage.setItem(key, payloads[attempt]);
      if (attempt > 0) {
        console.warn("[trade-store] localStorage quota exceeded; wrote a smaller snapshot", {
          key,
          attempt,
          bytes: payloads[attempt].length,
        });
      }
      return;
    } catch (err) {
      last = err;
      if (!isQuotaError(err)) {
        throw new Error(
          `trade-store persist failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  try {
    storage.removeItem(key);
  } catch (err) {
    console.warn("[trade-store] could not clear oversized key", {
      key,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  console.warn("[trade-store] localStorage quota exceeded; persistence skipped", {
    key,
    bytes: value.length,
    message: last instanceof Error ? last.message : String(last),
  });
}

function selfCheck() {
  const quota = new Error("quota");
  quota.name = "QuotaExceededError";
  const mem = new Map<string, string>();
  const storage: QuotaStorage = {
    setItem(key, value) {
      if (value.includes('"body"')) throw quota;
      mem.set(key, value);
    },
    removeItem(key) {
      mem.delete(key);
    },
  };
  const big = JSON.stringify({
    state: {
      deals: [
        {
          id: "local-1",
          sources: [{ body: "x".repeat(500) }],
          documents: [],
        },
      ],
      routing: { ops_copilot: "AA" },
      dealCodeSeq: 1100,
      displayCurrency: "all",
      stageFilter: "all",
      productionDueFilter: "all",
      commercialModelFilter: "all",
      partyProfiles: [],
      supplierApplications: [],
    },
    version: 0,
  });
  writeWithQuota(storage, "k", big);
  const saved = JSON.parse(mem.get("k") || "null") as {
    state?: { routing?: { ops_copilot?: string }; deals?: unknown[] };
  };
  if (saved?.state?.routing?.ops_copilot !== "AA") {
    throw new Error("prefs dropped after quota");
  }
  if (JSON.stringify(saved).includes('"body"')) {
    throw new Error("quota retry still stored source bodies");
  }
  let cleared = false;
  const alwaysFull = {
    setItem() {
      throw quota;
    },
    removeItem() {
      cleared = true;
    },
  };
  writeWithQuota(alwaysFull, "k2", big);
  if (!cleared) throw new Error("oversized key was not cleared");

  const snap = snapshotForStorage({
    deals: [
      {
        id: "mb-po",
        code: "c",
        title: "mail",
        stage: "requirement",
        createdAt: "",
        updatedAt: "",
        parties: [],
        documents: [],
        sources: [{ id: "1", kind: "requirement", body: "z".repeat(40_000) }],
        timeline: [],
        outreach: [],
      },
      {
        id: "user-1",
        code: "c",
        title: "local",
        stage: "requirement",
        createdAt: "",
        updatedAt: "",
        parties: [],
        documents: [
          {
            id: "d",
            name: "a",
            type: "other",
            uploadedAt: "",
            url: "data:application/pdf;base64,AAAA",
          },
        ],
        sources: [{ id: "2", kind: "requirement", body: "y".repeat(40_000) }],
        timeline: [],
        outreach: [],
        agentResult: { huge: true },
      },
    ],
    routing: { requirement_extractor: "AA00000025" } as AgentRoutingMap,
    partyProfiles: [
      {
        id: "p",
        role: "factory",
        name: "A",
        company: "A",
        categories: [],
        scores: {
          overall: 1,
          size: 1,
          output: 1,
          onTimeDelivery: 1,
          shipmentReliability: 1,
          quality: 1,
        },
        sourceApplicationId: "app",
      },
      {
        id: "demo",
        role: "factory",
        name: "B",
        company: "B",
        categories: [],
        scores: {
          overall: 1,
          size: 1,
          output: 1,
          onTimeDelivery: 1,
          shipmentReliability: 1,
          quality: 1,
        },
      },
    ],
    supplierApplications: [],
    dealCodeSeq: 1100,
    commercialModelFilter: "all",
    displayCurrency: "all",
    stageFilter: "all",
    productionDueFilter: "all",
  });
  if (snap.deals.length !== 1 || snap.deals[0]?.id !== "user-1") {
    throw new Error("mailbox deal was persisted");
  }
  if ((snap.deals[0]?.sources[0]?.body.length || 0) !== BODY_CAP) {
    throw new Error("source body was not capped");
  }
  if (snap.deals[0]?.agentResult) throw new Error("agentResult was persisted");
  if (snap.deals[0]?.documents[0]?.url) throw new Error("data url was persisted");
  if (snap.partyProfiles.length !== 1) throw new Error("demo profile was persisted");
  if ("opsIntel" in snap) throw new Error("opsIntel was persisted");
}

if (process.env.NODE_TEST === "1") selfCheck();
