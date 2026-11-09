import type { ProcessedDealRow } from "@/lib/trade/processedDealMapper";
import { partyRole, type ClassifyContext } from "./classify";
import { freshText, outcomeFor, parse } from "./inbox";
import type { InboxItem, InboxMessage, InboxOutcome } from "./inboxTypes";
import { AGENT_NAMES, cleanSubject, factsFor, firstName, templateDraft } from "./replyDraft";
import type { InboxMessageRow, MailConnectionRow, StoredAttachment } from "./types";

/**
 * Store rows → inbox conversations. One row per conversation: the newest mail
 * from the other side, the thread, what the stage agent found (when the deal
 * pipeline linked it to a deal) and a quick draft Copilot rewrites on open.
 */

const NOISE_SUBJECT =
  /^(automatic reply|auto(-|\s)?reply|out of office|undeliverable|delivery status notification|read:|accepted:|declined:|invitation:)/i;
const NOISE_SENDER = /no-?reply|noreply|mailer-daemon|postmaster|notification|newsletter/i;
const THREAD_CAP = 12;

type Mailbox = Pick<MailConnectionRow, "id" | "email" | "display_name">;

export type ItemContext = {
  mailboxes: Map<string, Mailbox>;
  classify: ClassifyContext;
  deals: Map<string, ProcessedDealRow>;
};

export function itemContext(mailboxes: Mailbox[], deals: ProcessedDealRow[]): ItemContext {
  return {
    mailboxes: new Map(mailboxes.map((m) => [m.id, m])),
    classify: { ownEmails: mailboxes.map((m) => m.email) },
    deals: new Map(deals.filter((d) => d.status === "completed").map((d) => [d.id, d])),
  };
}

function attachmentNames(row: InboxMessageRow) {
  const list = parse<StoredAttachment[]>(row.attachments_json, []);
  return list.filter((a) => a.name && !a.inline && !/^image\d+\./i.test(a.name)).map((a) => a.name);
}

function toMessage(row: InboxMessageRow, ctx: ItemContext): InboxMessage {
  const from = (row.from_email || "").toLowerCase();
  return {
    id: `${row.connection_id}|${row.provider_message_id}`,
    from,
    fromName: (row.from_name || "").replace(/["']/g, "").trim(),
    to: row.to_text || "",
    cc: row.cc_text || "",
    date: row.sent_at,
    subject: row.subject || "",
    body: freshText(row.body_text || ""),
    attachments: attachmentNames(row),
    internal: ctx.classify.ownEmails?.includes(from) || partyRole(from, ctx.classify) === "internal",
  };
}

function signerOf(mailbox: Mailbox | undefined) {
  const name = (mailbox?.display_name || "").trim();
  if (name) return name.split(/\s+/)[0]!;
  return firstName("", mailbox?.email || "");
}

function generalDraft(latest: InboxMessage, subject: string, signer: string) {
  return [
    `Dear ${firstName(latest.fromName, latest.from)},`,
    "",
    `Thank you for your email regarding "${cleanSubject(subject)}".`,
    "",
    "We are looking into this and will revert shortly.",
    "",
    "Best regards,",
    signer,
    "Savvy Net Sourcing",
  ].join("\n");
}

/** `rows` = one conversation, oldest → newest. */
export function buildInboxItem(threadKey: string, rows: InboxMessageRow[], ctx: ItemContext): InboxItem | null {
  if (!rows.length) return null;
  const thread = rows.map((r) => toMessage(r, ctx));
  const externalIdx = thread.map((m) => !m.internal && Boolean(m.from)).lastIndexOf(true);
  const latestIdx = externalIdx >= 0 ? externalIdx : thread.length - 1;
  const latest = thread[latestIdx]!;
  const latestRow = rows[latestIdx]!;
  const repliedAfter = externalIdx >= 0 && thread.slice(externalIdx + 1).some((m) => m.internal);
  const mailbox = ctx.mailboxes.get(latestRow.connection_id);
  const signer = signerOf(mailbox);
  const subject = latest.subject || "(no subject)";

  const dealKey = [...rows].reverse().map((r) => r.deal_key).find((k) => k && ctx.deals.has(k)) || null;
  const deal = dealKey ? ctx.deals.get(dealKey)! : null;
  const slot = deal?.slot || null;
  const result = deal ? parse<Record<string, unknown>>(deal.result_json, {}) : {};
  const confidence = deal && typeof deal.confidence === "number" ? deal.confidence : null;

  let outcome: InboxOutcome;
  let note: string | null;
  if (deal) {
    ({ outcome, note } = outcomeFor(slot, result, confidence, latest, repliedAfter));
  } else if (NOISE_SUBJECT.test(subject) || NOISE_SENDER.test(latest.from)) {
    outcome = "fyi";
    note = "Automatic or notification mail — no reply needed.";
  } else if (repliedAfter) {
    outcome = "replied";
    note = "Your team already replied after this mail.";
  } else if (externalIdx < 0) {
    outcome = "waiting";
    note = "Last mail is from your side — waiting for their reply.";
  } else {
    outcome = "draft_ready";
    note = null;
  }

  const wantsDraft = outcome === "draft_ready" || outcome === "needs_you";
  return {
    id: `${threadKey}`,
    subject,
    latest,
    thread: thread.slice(-THREAD_CAP),
    outcome,
    note,
    stage: deal?.primary_stage || null,
    slot,
    agentName: (slot && AGENT_NAMES[slot]) || (deal ? "Stage worker" : "Vibrium Copilot"),
    agentId: deal?.agent_id || null,
    summary: deal ? deal.summary || (typeof result.summary === "string" ? result.summary : null) : null,
    confidence,
    facts: deal ? factsFor(slot, result) : [],
    poNumbers: deal ? parse<string[]>(deal.po_numbers, []).map(String) : [],
    signer,
    draft: wantsDraft
      ? {
          to: latest.from,
          toName: latest.fromName,
          subject: `Re: ${cleanSubject(subject)}`,
          body: deal ? templateDraft({ slot, result, latest, subject, signer }) : generalDraft(latest, subject, signer),
          by: "template",
        }
      : null,
    dealId: deal?.id || null,
    mailbox: {
      connectionId: latestRow.connection_id,
      mailboxEmail: mailbox?.email || "",
      mailboxName: mailbox?.display_name || null,
      messageId: latestRow.provider_message_id,
      internetMessageId: latestRow.internet_message_id,
      threadKey,
    },
  };
}
