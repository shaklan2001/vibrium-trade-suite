import type { FactoryRecommendation, PartyProfile, RequirementFields } from "@/types/trade";

function scores(
  size: number,
  output: number,
  onTimeDelivery: number,
  shipmentReliability: number,
  quality: number,
) {
  const overall = Math.round(
    size * 0.12 +
      output * 0.18 +
      onTimeDelivery * 0.25 +
      shipmentReliability * 0.2 +
      quality * 0.25,
  );
  return { overall, size, output, onTimeDelivery, shipmentReliability, quality };
}

/** Seeded SNSPL trading partners — scores are ops-calibrated composites. */
export const SEED_PARTY_PROFILES: PartyProfile[] = [
  {
    id: "buyer-petrageous",
    role: "buyer",
    name: "Gretchen George",
    company: "Petrageous Designs",
    email: "gretchen@petrageousdesigns.com",
    country: "USA",
    categories: ["leather toys", "suede toys", "pet toys"],
    scores: scores(72, 68, 80, 78, 82),
    notes: "Repeat US importer; clear cost targets; responsive on selection.",
    activeDealsHint: 2,
  },
  {
    id: "buyer-loving-pets",
    role: "buyer",
    name: "Buying desk",
    company: "Loving Pets",
    country: "USA",
    categories: ["pet accessories", "mats", "leather toys"],
    scores: scores(85, 80, 74, 76, 79),
    notes: "High volume PO cadence; expects tight PI/PO alignment.",
    activeDealsHint: 2,
  },
  {
    id: "buyer-neater",
    role: "buyer",
    name: "Merchandising",
    company: "Neater Pets / Tower Star",
    country: "USA",
    categories: ["silicone mats", "lick mats", "packaging"],
    scores: scores(78, 75, 77, 72, 88),
    notes: "Artwork and UPC loops are intensive; quality-sensitive.",
    activeDealsHint: 2,
  },
  {
    id: "buyer-global-praise",
    role: "buyer",
    name: "Buyer desk",
    company: "Global Praise",
    country: "USA",
    categories: ["plush", "soft toys", "pet toys"],
    scores: scores(70, 65, 72, 70, 75),
    notes: "Selection often needs chase; solid once locked.",
    activeDealsHint: 1,
  },
  {
    id: "factory-yk",
    role: "factory",
    name: "Yash",
    company: "Y.K. Industries",
    email: "yash@ykindustries.co.in",
    country: "India",
    city: "Moradabad / NCR",
    categories: ["leather toys", "suede toys", "pet toys", "rope toys"],
    scores: scores(76, 82, 78, 80, 84),
    avgLeadDays: 45,
    moqTypical: 500,
    notes: "Strong leather/suede toy AS sheets; reliable booking support.",
    activeDealsHint: 3,
  },
  {
    id: "factory-swastik",
    role: "factory",
    name: "Production",
    company: "Swastik Industries",
    email: "factory@swastikindustries.in",
    country: "India",
    categories: ["pet accessories", "mats", "leather toys", "hardlines"],
    scores: scores(88, 90, 68, 74, 77),
    avgLeadDays: 55,
    moqTypical: 1000,
    notes: "Large capacity; watch material delays and PI vs PO gaps.",
    activeDealsHint: 2,
  },
  {
    id: "factory-v3f",
    role: "factory",
    name: "Rishi Kalra",
    company: "Barktrunk / V Three Fortunes",
    country: "India",
    categories: ["leather toys", "pet toys", "packing"],
    scores: scores(64, 70, 82, 85, 80),
    avgLeadDays: 40,
    moqTypical: 1000,
    notes: "Solid on-time and docs; good parallel quote lane.",
    activeDealsHint: 1,
  },
  {
    id: "factory-ethical",
    role: "factory",
    name: "Factory desk",
    company: "Ethical Exports",
    country: "India",
    categories: ["leather toys", "suede toys"],
    scores: scores(60, 58, 70, 68, 72),
    avgLeadDays: 50,
    moqTypical: 800,
    notes: "Mentioned in Petrageous current-sourcing notes; secondary option.",
    activeDealsHint: 0,
  },
];

export function recommendFactories(
  requirement?: RequirementFields | null,
  profiles: PartyProfile[] = [],
  limit = 3,
): FactoryRecommendation[] {
  const factories = profiles.filter((p) => p.role === "factory");
  const cat = (
    requirement?.productCategory ||
    requirement?.materials ||
    ""
  ).toLowerCase();
  const targetCost = requirement?.targetFactoryCost;

  return factories
    .map((f) => {
      const fitReasons: string[] = [];
      let score = f.scores.overall;

      const catHit = f.categories.some(
        (c) => cat.includes(c.toLowerCase()) || c.toLowerCase().includes(cat.split(/[/,]/)[0]?.trim() || "___"),
      );
      if (cat && catHit) {
        score += 12;
        fitReasons.push(`Category fit: ${f.categories.slice(0, 2).join(", ")}`);
      } else if (cat) {
        score -= 8;
      }

      if (f.scores.onTimeDelivery >= 78) {
        score += 4;
        fitReasons.push(`On-time ${f.scores.onTimeDelivery}`);
      }
      if (f.scores.quality >= 80) {
        score += 4;
        fitReasons.push(`Quality ${f.scores.quality}`);
      }
      if (f.scores.shipmentReliability >= 80) {
        fitReasons.push(`Shipments ${f.scores.shipmentReliability}`);
      }
      if (f.avgLeadDays != null && f.avgLeadDays <= 45) {
        fitReasons.push(`Lead ~${f.avgLeadDays}d`);
      }

      let caution: string | undefined;
      if (f.readinessClass === "export_ready") {
        score += 6;
        fitReasons.push("HUB export ready");
      } else if (f.readinessClass === "export_ready_with_conditions") {
        score += 3;
        fitReasons.push("HUB ready with conditions");
      } else if (f.readinessClass === "not_currently_export_ready") {
        score -= 6;
        caution = "HUB: not currently export ready.";
      }

      const materials = (requirement?.materials || "").toLowerCase();
      if (
        materials &&
        f.materials?.some(
          (m) =>
            materials.includes(m.toLowerCase()) ||
            m
              .toLowerCase()
              .includes(materials.split(/[/,]/)[0]?.trim() || "___"),
        )
      ) {
        score += 5;
        fitReasons.push(`Material fit: ${f.materials.slice(0, 2).join(", ")}`);
      }

      if (f.scores.onTimeDelivery < 70) {
        caution =
          (caution ? caution + " " : "") +
          "Historically slower on ready dates — build buffer.";
        score -= 5;
      }
      if (targetCost != null && targetCost < 1 && f.moqTypical && f.moqTypical > 800) {
        caution = (caution ? caution + " " : "") + "Higher typical MOQ vs tight cost brief.";
      }

      if (fitReasons.length === 0) {
        fitReasons.push(`Composite score ${f.scores.overall}`);
      }

      return {
        profileId: f.id,
        company: f.company,
        score: Math.max(0, Math.min(100, Math.round(score))),
        fitReasons,
        caution,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function parseEmailMeta(body: string): {
  subject?: string;
  from?: string;
  to?: string;
} {
  const from = body.match(/^From:\s*(.+)$/im)?.[1]?.trim();
  const to = body.match(/^To:\s*(.+)$/im)?.[1]?.trim();
  const subject = body.match(/^Subject:\s*(.+)$/im)?.[1]?.trim();
  return { from, to, subject };
}
