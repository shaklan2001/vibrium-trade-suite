import type { Deal } from "@/types/trade";

/** Build a lowercase haystack of names, titles, and emails for a deal. */
export function dealSearchBlob(deal: Deal): string {
  const parts: string[] = [
    deal.id,
    deal.code,
    deal.title,
    deal.mailboxSourceId || "",
    ...(deal.mailboxPoNumbers || []),
  ];
  for (const p of deal.parties || []) {
    parts.push(p.name || "", p.company || "", p.email || "");
  }
  for (const s of deal.sources || []) {
    parts.push(
      s.subject || "",
      s.from || "",
      s.to || "",
      s.cc || "",
      s.bcc || "",
      s.label || "",
    );
  }
  return parts.filter(Boolean).join("\n").toLowerCase();
}

/** Match a free-text query (deal name, party, email, team mailbox like kalpana). */
export function dealMatchesSearch(deal: Deal, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const blob = dealSearchBlob(deal);
  // Support multi-token AND (e.g. "kalpana bowls")
  return q.split(/\s+/).every((token) => blob.includes(token));
}
