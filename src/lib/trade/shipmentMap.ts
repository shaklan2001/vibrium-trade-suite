/** Derive trade-map shipments / ports from deal bookings. */
import type { Deal } from "@/types/trade";
import { ensureDealEconomics } from "./commandCenterMetrics";

export type MapFilterMode = "all" | "delayed" | "on_water" | "arrived";

export type MapShipmentStatus =
  | "planned"
  | "about_to_sail"
  | "in_waters"
  | "about_to_arrive"
  | "arrived";

/** [lon, lat] */
export type LonLat = [number, number];

export interface MapPort {
  code: string;
  name: string;
  country: string;
  coords: LonLat;
  congestionLevel: number;
  avgWaitDays: number;
}

export interface MapShipment {
  id: string;
  dealId: string;
  dealCode: string;
  title: string;
  vessel: string;
  voyage?: string;
  carrier?: string;
  originPort: string;
  destinationPort: string;
  coords: { origin: LonLat; dest: LonLat };
  status: MapShipmentStatus;
  delayDays: number;
  etd?: string;
  eta?: string;
  blNumber?: string;
  cargoValueUsd: number;
  href: string;
}

const PORTS: Record<string, MapPort> = {
  INMUN: {
    code: "INMUN",
    name: "Mundra",
    country: "India",
    coords: [69.72, 22.84],
    congestionLevel: 2,
    avgWaitDays: 1.4,
  },
  INNSA: {
    code: "INNSA",
    name: "Nhava Sheva",
    country: "India",
    coords: [72.95, 18.95],
    congestionLevel: 3,
    avgWaitDays: 2.6,
  },
  INMAA: {
    code: "INMAA",
    name: "Chennai",
    country: "India",
    coords: [80.3, 13.08],
    congestionLevel: 2,
    avgWaitDays: 1.8,
  },
  USNYC: {
    code: "USNYC",
    name: "New York",
    country: "USA",
    coords: [-74.0, 40.68],
    congestionLevel: 3,
    avgWaitDays: 2.1,
  },
  USLAX: {
    code: "USLAX",
    name: "Los Angeles",
    country: "USA",
    coords: [-118.26, 33.74],
    congestionLevel: 4,
    avgWaitDays: 3.2,
  },
  USLGB: {
    code: "USLGB",
    name: "Long Beach",
    country: "USA",
    coords: [-118.19, 33.75],
    congestionLevel: 3,
    avgWaitDays: 2.8,
  },
  NLRTM: {
    code: "NLRTM",
    name: "Rotterdam",
    country: "Netherlands",
    coords: [4.48, 51.95],
    congestionLevel: 2,
    avgWaitDays: 1.1,
  },
  SGSIN: {
    code: "SGSIN",
    name: "Singapore",
    country: "Singapore",
    coords: [103.85, 1.26],
    congestionLevel: 2,
    avgWaitDays: 0.9,
  },
  AEJEA: {
    code: "AEJEA",
    name: "Jebel Ali",
    country: "UAE",
    coords: [55.06, 24.99],
    congestionLevel: 2,
    avgWaitDays: 1.2,
  },
  CNSHA: {
    code: "CNSHA",
    name: "Shanghai",
    country: "China",
    coords: [121.5, 31.4],
    congestionLevel: 3,
    avgWaitDays: 2.4,
  },
  HKHKG: {
    code: "HKHKG",
    name: "Hong Kong",
    country: "Hong Kong",
    coords: [114.17, 22.29],
    congestionLevel: 2,
    avgWaitDays: 1.5,
  },
  JPTYO: {
    code: "JPTYO",
    name: "Tokyo",
    country: "Japan",
    coords: [139.77, 35.62],
    congestionLevel: 1,
    avgWaitDays: 0.7,
  },
};

const NAME_TO_CODE: Record<string, string> = {
  mundra: "INMUN",
  "nhava sheva": "INNSA",
  nhava: "INNSA",
  chennai: "INMAA",
  "new york": "USNYC",
  nyc: "USNYC",
  "los angeles": "USLAX",
  la: "USLAX",
  "long beach": "USLGB",
  rotterdam: "NLRTM",
  singapore: "SGSIN",
  "jebel ali": "AEJEA",
  shanghai: "CNSHA",
  "hong kong": "HKHKG",
  tokyo: "JPTYO",
};

function resolvePort(raw?: string, fallback = "INMUN"): MapPort {
  if (!raw) return PORTS[fallback]!;
  const trimmed = raw.trim();
  if (PORTS[trimmed.toUpperCase()]) return PORTS[trimmed.toUpperCase()]!;
  const key = trimmed.toLowerCase();
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (key.includes(name)) return PORTS[code]!;
  }
  return PORTS[fallback]!;
}

function statusFromDeal(deal: Deal): MapShipmentStatus {
  const s = deal.booking?.shipmentStatus;
  if (s === "in_waters") return "in_waters";
  if (s === "about_to_arrive" || s === "arrived") return "arrived";
  if (s === "about_to_sail") return "about_to_sail";
  if (s === "planned") return "planned";
  if (deal.stage === "docs_payment" || deal.stage === "closed") return "in_waters";
  if (deal.stage === "booking") return "about_to_sail";
  return "planned";
}

function delayDays(deal: Deal, status: MapShipmentStatus): number {
  if (status === "arrived") return 0;
  if (status === "about_to_sail") return 0;
  // Real delay only when ETA is past and shipment not arrived.
  const eta = deal.booking?.eta;
  if (eta && status === "in_waters") {
    const days = Math.floor((Date.now() - Date.parse(eta)) / 86400000);
    return days > 0 ? days : 0;
  }
  return 0;
}

export function listMapPorts(): MapPort[] {
  return Object.values(PORTS);
}

export function buildMapShipmentsFromDeals(deals: Deal[]): MapShipment[] {
  const fromDeals: MapShipment[] = [];
  for (const deal of deals) {
    const booking = deal.booking;
    if (!booking && deal.stage !== "booking" && deal.stage !== "docs_payment") {
      continue;
    }
    const origin = resolvePort(booking?.pol, "INMUN");
    const dest = resolvePort(booking?.pod, "USNYC");
    const status = statusFromDeal(deal);
    const econ = ensureDealEconomics(deal);
    fromDeals.push({
      id: `deal-ship-${deal.id}`,
      dealId: deal.id,
      dealCode: deal.code,
      title: deal.title,
      vessel: booking?.vessel || "TBN",
      voyage: booking?.voyage,
      carrier: booking?.carrier,
      originPort: origin.code,
      destinationPort: dest.code,
      coords: { origin: origin.coords, dest: dest.coords },
      status,
      delayDays: delayDays(deal, status),
      etd: booking?.etd,
      eta: booking?.eta,
      blNumber: booking?.bookingNumber,
      cargoValueUsd: econ.commercialValueUsd || 0,
      href: `/deals/${deal.id}`,
    });
  }

  return fromDeals;
}

export function filterMapShipments(
  shipments: MapShipment[],
  filter: MapFilterMode,
): MapShipment[] {
  if (filter === "delayed") return shipments.filter((s) => s.delayDays > 0);
  if (filter === "on_water")
    return shipments.filter(
      (s) => s.status === "in_waters" || s.status === "about_to_sail",
    );
  if (filter === "arrived")
    return shipments.filter(
      (s) => s.status === "arrived" || s.status === "about_to_arrive",
    );
  return shipments;
}

export function progressForMapStatus(status: MapShipmentStatus): number {
  const map: Record<MapShipmentStatus, number> = {
    planned: 0.08,
    about_to_sail: 0.18,
    in_waters: 0.55,
    about_to_arrive: 0.82,
    arrived: 0.95,
  };
  return map[status];
}

export function shipmentStrokeColor(s: MapShipment): string {
  if (s.delayDays > 3) return "#ef4444";
  if (s.delayDays > 0) return "#f59e0b";
  return "#0ea5e9";
}

export function congestionColor(level: number): string {
  if (level >= 4) return "#ef4444";
  if (level >= 3) return "#f59e0b";
  if (level >= 2) return "#38bdf8";
  return "#34d399";
}
