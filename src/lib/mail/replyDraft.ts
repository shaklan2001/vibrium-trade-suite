import type { InboxFact, InboxMessage } from "./inboxTypes";

/**
 * Reply drafting from what the stage worker already extracted. Instant and
 * deterministic — the inbox shows this first; the Copilot rewrite (replyAgent)
 * can replace it. Only uses facts present in the worker result; never invents
 * prices, dates or commitments.
 */

type Result = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? v : []);

export const AGENT_NAMES: Record<string, string> = {
  requirement_extractor: "Requirement Extractor",
  quote_normalizer: "Quote Normalizer",
  artwork_checklist_extractor: "Artwork Checklist",
  sample_request_summarizer: "Sample Request Summarizer",
  pi_extractor: "PI Extractor",
  po_extractor: "PO Extractor",
  inspection_photo_summarizer: "Inspection Summarizer",
  booking_extractor: "Booking Extractor",
  final_docs_pack_check: "Docs Pack Checker",
  payment_clock: "Payment Clock",
  commission_checklist: "Commission Checklist",
};

function money(currency: string, amount: number | null) {
  if (amount == null) return "";
  return `${currency || "USD"} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function bullets(items: string[], max = 6) {
  return items
    .filter(Boolean)
    .slice(0, max)
    .map((i) => `- ${i}`)
    .join("\n");
}

export function cleanSubject(subject: string) {
  let s = subject.trim();
  while (/^(re|fw|fwd|aw|sv)\s*:\s*/i.test(s)) s = s.replace(/^(re|fw|fwd|aw|sv)\s*:\s*/i, "");
  return s;
}

export function firstName(name: string, email: string) {
  const fromName = name.replace(/["']/g, "").trim();
  const base = fromName || email.split("@")[0] || "";
  const word = base.split(/[\s._-]+/).find((w) => /[a-z]/i.test(w)) || "";
  if (!word) return "Sir/Madam";
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** Key facts as chips for the agent card. */
export function factsFor(slot: string | null, r: Result): InboxFact[] {
  const out: InboxFact[] = [];
  const add = (label: string, value: string) => {
    if (value) out.push({ label, value: value.length > 60 ? `${value.slice(0, 57)}…` : value });
  };
  const route = [str(r.pol), str(r.pod)].filter(Boolean).join(" → ");
  switch (slot) {
    case "booking_extractor":
      add("Booking", str(r.bookingNumber));
      add("Vessel", [str(r.vessel), str(r.voyage)].filter(Boolean).join(" / "));
      add("Route", route);
      add("ETD", str(r.etd));
      add("ETA", str(r.eta));
      add("Equipment", str(r.equipment));
      break;
    case "po_extractor":
    case "pi_extractor":
      add(slot === "po_extractor" ? "PO" : "PI", str(r.docNumber));
      add("Buyer", str(r.buyer));
      add("Factory", str(r.factory));
      add("Value", money(str(r.currency), num(r.totalAmount)));
      add("Ready date", str(r.readyDate));
      add("CBM", num(r.totalCbm) != null ? String(Math.round(num(r.totalCbm)! * 100) / 100) : "");
      break;
    case "final_docs_pack_check": {
      const missing = list(r.missing).map(String);
      add("Route", route);
      add("Missing docs", missing.length ? `${missing.length} (${missing.slice(0, 2).join(", ")}${missing.length > 2 ? "…" : ""})` : "none");
      add("ETD", str(r.etd));
      add("Vessel", str(r.vessel));
      break;
    }
    case "payment_clock":
      add("Status", str(r.status).replace(/_/g, " "));
      add("Amount", money("USD", num(r.amountUsd)));
      add("Due", str(r.dueDate));
      add("BL shared", str(r.blSharedDate));
      break;
    case "inspection_photo_summarizer":
      add("Result", str(r.overall));
      add("Findings", String(list(r.findings).length || ""));
      break;
    case "sample_request_summarizer":
      add("Items", list(r.items).map(String).slice(0, 2).join(", "));
      add("Courier", str(r.courier));
      add("Tracking", str(r.trackingNumber));
      add("Dispatch", str(r.dispatchDate));
      break;
    case "requirement_extractor":
      add("Buyer", str(r.buyerCompany));
      add("Category", str(r.productCategory));
      add("Urgency", str(r.urgency));
      add("Open questions", String(list(r.openQuestions).length || ""));
      break;
    case "quote_normalizer":
      add("Factory", str(r.factoryName));
      add("SKUs", String(list(r.skus).length || ""));
      add("Lead time", num(r.leadTimeDays) != null ? `${num(r.leadTimeDays)} days` : "");
      add("Terms", str(r.paymentTerms));
      break;
    case "artwork_checklist_extractor":
    case "commission_checklist": {
      const items = list(r.items) as Result[];
      const pending = items.filter((i) => i.done === false || /pending|missing/i.test(str(i.status)));
      add("Items", String(items.length || ""));
      add("Pending", String(pending.length));
      break;
    }
  }
  return out;
}

/** Body lines specific to what the worker found. */
function stageLines(slot: string | null, r: Result): string[] {
  switch (slot) {
    case "final_docs_pack_check": {
      const missing = list(r.missing).map(String).filter(Boolean);
      const lines: string[] = [];
      if (str(r.etd)) lines.push(`Noted the ETD of ${str(r.etd)}.`);
      lines.push(
        missing.length
          ? `To complete the shipment documents, could you please share the following at the earliest:\n${bullets(missing)}`
          : "We have the shipment documents we need. We will review them and revert if anything further is required.",
      );
      return lines;
    }
    case "booking_extractor": {
      const parts = [
        [str(r.vessel), str(r.voyage)].filter(Boolean).join(" / "),
        [str(r.pol), str(r.pod)].filter(Boolean).join(" → "),
        str(r.etd) ? `ETD ${str(r.etd)}` : "",
        str(r.eta) ? `ETA ${str(r.eta)}` : "",
      ].filter(Boolean);
      const lines = [
        `Noted the booking details${str(r.bookingNumber) ? ` (booking ${str(r.bookingNumber)})` : ""}${parts.length ? `: ${parts.join(", ")}` : ""}.`,
      ];
      const cut = typeof r.cutOffs === "string" ? str(r.cutOffs) : "";
      lines.push(
        `Please make sure the cargo is ready and gated in before the cut-off${cut ? ` (${cut})` : ""}, and share the draft BL for our review once available.`,
      );
      return lines;
    }
    case "po_extractor": {
      const value = money(str(r.currency), num(r.totalAmount));
      let ack = `We acknowledge ${str(r.docNumber) ? `PO ${str(r.docNumber)}` : "the PO"}`;
      if (str(r.buyer)) ack += ` from ${str(r.buyer)}`;
      if (value) ack += ` with a total value of ${value}`;
      return [
        `${ack}.`,
        str(r.readyDate)
          ? `Please confirm the cargo will be ready by ${str(r.readyDate)} and share the proforma invoice against this PO.`
          : "Please confirm the production schedule and expected ready date, and share the proforma invoice against this PO.",
      ];
    }
    case "pi_extractor": {
      const value = money(str(r.currency), num(r.totalAmount));
      return [
        `Thank you for the proforma invoice${str(r.docNumber) ? ` ${str(r.docNumber)}` : ""}${value ? ` for ${value}` : ""}.`,
        "We will share it with the buyer for confirmation and revert.",
        str(r.readyDate) ? `Please also reconfirm the ready date of ${str(r.readyDate)}.` : "Please also confirm the expected ready date.",
      ];
    }
    case "payment_clock": {
      const amount = money("USD", num(r.amountUsd));
      const lines = ["Noted on the payment."];
      if (amount || str(r.dueDate))
        lines.push(`As per our records${amount ? `, ${amount}` : ""} is due${str(r.dueDate) ? ` by ${str(r.dueDate)}` : ""}.`);
      lines.push("We will follow up with the buyer and confirm once the remittance is made.");
      return lines;
    }
    case "inspection_photo_summarizer": {
      const findings = (list(r.findings) as Result[])
        .map((f) => str(f.notes) || str(f.issue) || str(f.description))
        .filter(Boolean)
        .map((t) => (t.length > 180 ? `${t.slice(0, 177)}…` : t));
      return [
        "Thank you for the inspection update.",
        findings.length
          ? `Please make sure the following points are addressed before shipment:\n${bullets(findings, 4)}`
          : "Please share the final inspection report once available.",
        "Kindly confirm once the corrections are done or the re-inspection is booked.",
      ];
    }
    case "sample_request_summarizer": {
      const items = list(r.items).map(String).filter(Boolean);
      return [
        `Noted the sample request${items.length ? ` for ${items.slice(0, 3).join(", ")}` : ""}.`,
        str(r.trackingNumber)
          ? `Thank you for the courier details (${[str(r.courier), str(r.trackingNumber)].filter(Boolean).join(" ")}). We will track the delivery.`
          : "Please share the courier and tracking details once the samples are dispatched.",
      ];
    }
    case "artwork_checklist_extractor": {
      const pending = (list(r.items) as Result[])
        .filter((i) => /pending|missing|revis/i.test(str(i.status)))
        .map((i) => `${str(i.asset) || "Artwork"}${str(i.status) ? ` (${str(i.status)})` : ""}`);
      return pending.length
        ? ["We have noted the artwork status. The following items are still pending confirmation:", bullets(pending), "We will follow up for approval and revert."]
        : ["Thank you for the artwork update. We will review and revert with approval."];
    }
    case "commission_checklist": {
      const open = (list(r.items) as Result[]).filter((i) => i.done === false).map((i) => str(i.item));
      return open.length
        ? [`To close the commission records, could you please share:\n${bullets(open)}`]
        : ["Thank you — the commission records are complete on our side."];
    }
    case "requirement_extractor": {
      const qs = list(r.openQuestions).map(String).filter(Boolean);
      const lines = [
        `Thank you for the enquiry${str(r.productCategory) ? ` for ${str(r.productCategory)}` : ""}. We are checking with our factories and will share quotations shortly.`,
      ];
      if (qs.length) lines.push(`To quote accurately, could you please confirm:\n${bullets(qs, 5)}`);
      return lines;
    }
    case "quote_normalizer": {
      const skus = list(r.skus).length;
      return [
        `Thank you for sharing the quotation${str(r.factoryName) ? ` from ${str(r.factoryName)}` : ""}${skus ? ` (${skus} item${skus === 1 ? "" : "s"})` : ""}.`,
        num(r.leadTimeDays) != null ? `Noted the lead time of ${num(r.leadTimeDays)} days.` : "Please confirm the lead time for these items.",
        "We will review the prices and revert with the buyer's feedback.",
      ];
    }
    default:
      return ["Noted, thank you. We will review and revert shortly."];
  }
}

export function templateDraft(opts: {
  slot: string | null;
  result: Result;
  latest: InboxMessage;
  subject: string;
  signer: string;
}) {
  const greeting = `Dear ${firstName(opts.latest.fromName, opts.latest.from)},`;
  const body = [
    greeting,
    "",
    `Thank you for your email regarding "${cleanSubject(opts.subject)}".`,
    "",
    stageLines(opts.slot, opts.result).join("\n\n"),
    "",
    "Best regards,",
    opts.signer,
    "Savvy Net Sourcing",
  ].join("\n");
  return body.replace(/\n{3,}/g, "\n\n");
}
