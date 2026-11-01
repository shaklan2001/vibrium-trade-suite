/** Freight / GST / origin-charge extracts are not trade order value. */
export function isLocalChargesNarrative(text?: string): boolean {
  if (!text?.trim()) return false;
  return (
    /\b(origin\s+charges|local\s+(?:freight|export)\s+charges|forwarder|GST\s+included|BL\s+FEE|THC)\b/i.test(
      text,
    ) &&
    !/\b(?:order\s+value|commercial\s+value|FOB\s+value|total\s+(?:PO|PI|order))\b/i.test(
      text,
    )
  );
}
