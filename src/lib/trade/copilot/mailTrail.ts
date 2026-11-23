/**
 * Live email trail for the deals a Copilot answer is about.
 *
 * The cached book is loaded without evidence (list_deals omits it — it can be several MB),
 * so deal cards had no emails and Copilot answered from the agent summary alone, which can
 * be days older than the newest mail. This reads each deal's latest emails straight from
 * the mail store — current even before the stage agent re-reads the deal — and gives every
 * email its own inbox link (src/lib/mail/mailLink.ts).
 */
import { docTextsFor, type StoredFile } from "@/lib/mail/docStore";
import { DOC_TYPE_LABELS } from "@/lib/mail/docText";
import { freshText } from "@/lib/mail/inbox";
import { mailHref } from "@/lib/mail/mailLink";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import type { Deal, SourceMessage } from "@/types/trade";

const PER_DEAL = 12;
const BODY_CHARS = 1_500;

export async function withMailTrail(deal: Deal): Promise<Deal> {
  if (!deal.mailboxSourceId || !mailStoreConfigured()) return deal;
  try {
    const rows = await getMailStore().messagesForDeal(deal.mailboxSourceId, PER_DEAL * 2);
    const seen = new Set<string>();
    const sources: SourceMessage[] = [];
    for (const m of rows) {
      const id = m.internet_message_id || m.provider_message_id;
      // The same mail is often copied into several connected mailboxes.
      if (seen.has(id)) continue;
      seen.add(id);
      sources.push({
        id: `${deal.mailboxSourceId}-live-${id}`,
        kind: "other",
        subject: m.subject || undefined,
        from: m.from_name ? `${m.from_name} <${m.from_email || ""}>` : m.from_email || undefined,
        to: m.to_text || undefined,
        cc: m.cc_text || undefined,
        receivedAt: m.sent_at || undefined,
        body: freshText(m.body_text || "").slice(0, BODY_CHARS),
        messageId: id,
        mailHref: mailHref(deal, id),
      });
    }
    if (!sources.length) return deal;
    // Files on the deal (document layer): newest first, short excerpts.
    const files = [...rows].reverse().flatMap((m) => (m.attachments_json || []) as StoredFile[]);
    const docs = await docTextsFor(files, 4).catch(() => []);
    const docNotes = docs.map(
      (d) => `- File [${DOC_TYPE_LABELS[d.docType]}] ${d.name}: ${d.text.replace(/\s+/g, " ").slice(0, 700)}${d.text.length > 700 ? "…" : ""}`,
    );
    return { ...deal, sources: sources.slice(-PER_DEAL), docNotes };
  } catch (err) {
    console.warn("[copilot] mail trail unavailable", deal.code, err);
    return deal;
  }
}
