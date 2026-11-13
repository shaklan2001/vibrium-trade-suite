import { startSession, streamCompletion } from "@/lib/vibrium/chat";
import type { InboxItem } from "./inboxTypes";

/**
 * Rewrites a reply with the Vibrium Ops Copilot agent (VB… bot), grounded on
 * the thread and the stage worker's facts. Falls back to the template draft
 * when the agent is unavailable.
 */

const TIMEOUT_MS = 40_000;

function piece(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    const choices = json.choices as Array<{ delta?: { content?: string }; text?: string }> | undefined;
    for (const key of ["reply", "message", "delta", "content", "text"]) {
      if (typeof json[key] === "string") return json[key] as string;
    }
    return choices?.[0]?.delta?.content || choices?.[0]?.text || "";
  } catch {
    return payload;
  }
}

/** Same stream shapes the Copilot panel reads: SSE `data:` lines or plain text. */
async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let buffer = "";
  const take = (line: string) => {
    const t = line.replace(/\r$/, "");
    if (!t || t.startsWith(":") || t.startsWith("event:")) return;
    out += t.startsWith("data:") ? piece(t.slice(5).trim()) : `${t}\n`;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(take);
  }
  if (buffer) take(buffer);
  return out;
}

function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^```\w*$/gm, "")
    .replace(/^\s*(subject|re)\s*:.*\n/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Blank line between paragraphs; bullets and the sign-off block stay tight. */
function spaceParagraphs(text: string) {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const signOff = lines.findIndex((l) => /^(best|kind|warm)?\s*regards,?$/i.test(l.trim()));
  const body = signOff >= 0 ? lines.slice(0, signOff) : lines;
  const sign = signOff >= 0 ? lines.slice(signOff) : [];
  const bullet = (l: string) => /^\s*([-•*]|\d+[.)])\s/.test(l);
  const joined = body.reduce(
    (acc, line, i) => (i === 0 ? line : `${acc}${bullet(line) && (bullet(body[i - 1]!) || body[i - 1]!.endsWith(":")) ? "\n" : "\n\n"}${line}`),
    "",
  );
  return sign.length ? `${joined}\n\n${sign.join("\n")}` : joined;
}

function threadText(item: InboxItem) {
  return item.thread
    .slice(-6)
    .map(
      (m) =>
        `--- ${m.internal ? "US" : "THEM"} · ${m.fromName || m.from} <${m.from}> · ${m.date?.slice(0, 16) ?? ""}\nSubject: ${m.subject}\n${m.body.slice(0, 1500)}`,
    )
    .join("\n\n");
}

/**
 * v2 (Nov 2026). The deal-book backtest (scripts/eval-reply-backtest.ts) showed v1 drafts
 * hedged ("we are checking and will revert") where our people decided, added topics
 * nobody asked about, and ran twice as long as real SNSPL replies. v2 answers only the
 * newest mail, decides when the thread allows it, and writes the way SNSPL writes.
 */
export function replyPrompt(item: InboxItem, signer: string) {
  const facts = item.facts.map((f) => `${f.label}: ${f.value}`).join("; ");
  const background = [
    item.slot || item.summary ? `Deal stage: ${item.stage || "unknown"}. ${item.agentName} found: ${item.summary || "no summary"}` : "",
    facts ? `Extracted facts: ${facts}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    `You are drafting an email reply for ${signer} at Savvy Net Sourcing (SNSPL), a buying agency between overseas buyers and Indian factories. ${signer} reviews the draft and sends it.`,
    "Write ONLY the reply body in plain text: no markdown, no subject line, no notes to me.",
    "",
    "Write the way SNSPL replies:",
    "- Short and direct: usually 1–4 sentences, 15–70 words. No filler such as \"Thank you for your email\" and do not restate their mail.",
    "- Answer exactly what the newest email from THEM asks or tells us. Do not bring up other topics, reminders, missing documents or requests they did not raise.",
    "- Be decisive. If they ask us to approve, confirm, schedule, accept or send something and nothing in the thread argues against it, write it as done (\"The inspection on 29 May is confirmed.\"). " +
      `${signer} changes it if the answer is different.`,
    "- If they only share information or files, acknowledge it in one line and give the next step (\"We will share these with the buyer for approval.\").",
    "- If figures in their mail (quantity, price, weight, dates) differ from the PO or earlier mails in the thread, point out the difference and ask them to correct it instead of accepting it.",
    "- If they chase for an update and the thread does not have it, give a firm commitment (\"We will share the status by tomorrow.\") rather than \"we are checking\".",
    "- Use only facts from the thread. Never invent prices, quantities, dates, PO numbers or payment status. If the reply needs a figure that is not in the thread, write a placeholder like [date] or [price].",
    "- Greet them the way our side greeted them earlier in the thread; otherwise \"Dear <first name> ji,\" for Indian contacts and \"Dear <first name>,\" for others.",
    "",
    `Reply to: ${item.latest.fromName || item.latest.from} <${item.latest.from}>.`,
    background ? `Background for you only — do not raise it unless their mail asks about it:\n${background}` : "",
    `End with:\nRegards,\n${signer}`,
    "",
    "Email thread (oldest to newest):",
    threadText(item),
  ]
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** v1 prompt, kept only so the backtest can compare against it. */
export function replyPromptV1(item: InboxItem, signer: string) {
  const facts = item.facts.map((f) => `${f.label}: ${f.value}`).join("; ");
  return [
    `You are drafting an email reply for ${signer} at Savvy Net Sourcing (SNSPL), a buying agency between overseas buyers and Indian factories.`,
    "Write ONLY the reply email body in plain text: no markdown, no subject line, no notes to me.",
    "Keep it short (60–160 words), polite and specific. Use only facts from the thread and the extracted facts below.",
    "First answer what the newest email from THEM actually asks. Then raise anything the extracted facts show is still missing.",
    "Never invent prices, quantities, dates or commitments. If you can't confirm something (e.g. a payment), say we are checking and will revert.",
    "Separate paragraphs with a blank line.",
    `Reply to: ${item.latest.fromName || item.latest.from} <${item.latest.from}>.`,
    item.slot || item.summary
      ? `Deal stage: ${item.stage || "unknown"}. ${item.agentName} found: ${item.summary || "no summary"}`
      : "This mail is not linked to a deal yet — answer it from the thread alone.",
    facts ? `Extracted facts: ${facts}` : "",
    `End with:\nBest regards,\n${signer}\nSavvy Net Sourcing`,
    "",
    "Email thread (oldest to newest):",
    threadText(item),
  ]
    .filter(Boolean)
    .join("\n");
}

/** One prompt → the Copilot's full text answer, in a fresh chat session. */
export async function askCopilot(prompt: string, contactPrefix: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const contact = `${contactPrefix.replace(/[^a-z0-9-]/gi, "").slice(0, 50)}-${Date.now()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await startSession(contact);
    return await collect(await streamCompletion(contact, prompt, ctrl.signal));
  } finally {
    clearTimeout(timer);
  }
}

export async function copilotRewrite(
  item: InboxItem,
  signer: string,
  prompt: (item: InboxItem, signer: string) => string = replyPrompt,
): Promise<string> {
  const raw = await askCopilot(prompt(item, signer), `inbox-draft-${item.id.replace(/[^a-z0-9]/gi, "").slice(0, 40)}`);
  const text = spaceParagraphs(stripMarkdown(raw));
  if (text.length < 30) throw new Error("Copilot returned an empty draft");
  return text;
}
