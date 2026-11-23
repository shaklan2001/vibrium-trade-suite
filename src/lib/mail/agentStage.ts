/**
 * The stage worker's reading, used when it is sure enough to override
 * the keyword stage on a mail or a deal.
 */

const SLOT_STAGE: Record<string, string> = {
  booking_extractor: "booking",
  payment_clock: "payment",
  po_extractor: "pi_po",
  pi_extractor: "pi_po",
  final_docs_pack_check: "booking",
  inspection_photo_summarizer: "inspection",
  artwork_checklist_extractor: "artwork",
  sample_request_summarizer: "samples",
  requirement_extractor: "requirement",
  quote_normalizer: "quoting",
  commission_checklist: "commission",
};

export const AGENT_STAGE_MIN_CONFIDENCE = 0.6;

/** Mail stage for a finished worker slot, or null when the slot is unknown. */
export function stageForSlot(slot: string | null | undefined): string | null {
  if (!slot) return null;
  return SLOT_STAGE[slot] ?? null;
}

/**
 * Prefer the agent's stage when its confidence is at least 0.6.
 * Otherwise keep the keyword stage.
 */
export function preferredStage(
  keywordStage: string,
  agent?: {
    slot?: string | null;
    stage?: string | null;
    confidence?: number | null;
  } | null,
): string {
  if (agent?.confidence == null || agent.confidence < AGENT_STAGE_MIN_CONFIDENCE) {
    return keywordStage;
  }
  return agent.stage || stageForSlot(agent.slot) || keywordStage;
}
