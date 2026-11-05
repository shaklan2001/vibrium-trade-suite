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

export function replyPrompt(item: InboxItem, signer: string) {
  const thread = item.thread
    .slice(-6)
    .map(
      (m) =>
        `--- ${m.internal ? "US" : "THEM"} · ${m.fromName || m.from} <${m.from}> · ${m.date?.slice(0, 16) ?? ""}\nSubject: ${m.subject}\n${m.body.slice(0, 1500)}`,
    )
    .join("\n\n");
  const facts = item.facts.map((f) => `${f.label}: ${f.value}`).join("; ");
  return [
    `You are drafting an email reply for ${signer} at Savvy Net Sourcing (SNSPL), a buying agency between overseas buyers and Indian factories.`,
    "Write ONLY the reply email body in plain text: no markdown, no subject line, no notes to me.",
    "Keep it short (60–160 words), polite and specific. Use only facts from the thread and the extracted facts below.",
    "First answer what the newest email from THEM actually asks. Then raise anything the extracted facts show is still missing.",
    "Never invent prices, quantities, dates or commitments. If you can't confirm something (e.g. a payment), say we are checking and will revert.",
    "Separate paragraphs with a blank line.",
    `Reply to: ${item.latest.fromName || item.latest.from} <${item.latest.from}>.`,
    `Deal stage: ${item.stage || "unknown"}. ${item.agentName} found: ${item.summary || "no summary"}`,
    facts ? `Extracted facts: ${facts}` : "",
    `End with:\nBest regards,\n${signer}\nSavvy Net Sourcing`,
    "",
    "Email thread (oldest to newest):",
    thread,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function copilotRewrite(item: InboxItem, signer: string): Promise<string> {
  const contact = `inbox-draft-${item.id.replace(/[^a-z0-9]/gi, "").slice(0, 40)}-${Date.now()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await startSession(contact);
    const text = spaceParagraphs(
      stripMarkdown(await collect(await streamCompletion(contact, replyPrompt(item, signer), ctrl.signal))),
    );
    if (text.length < 30) throw new Error("Copilot returned an empty draft");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
