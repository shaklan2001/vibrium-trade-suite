import { ImapFlow, type ListResponse } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { MailAuthError } from "./providers/http";
import { cleanSubject } from "./replyDraft";
import type { MailConnectionRow, MailConnectionSettings } from "./types";

/**
 * The write side of an IMAP/SMTP mailbox (reading comes from the synced
 * store): send a reply over SMTP with the mailbox's own login, file the exact
 * bytes in Sent so Outlook/webmail shows it, or save it to Drafts.
 *
 * Message refs use the sync format `imap:<path>:<uidvalidity>:<uid>`; a stale
 * UID falls back to the RFC 822 Message-ID.
 */

type ImapCfg = NonNullable<MailConnectionSettings["imap"]>;
type SmtpCfg = NonNullable<MailConnectionSettings["smtp"]>;

const FULL_BYTES = 8 * 1024 * 1024;
const QUOTE_CHARS = 8000;

/** SMTP defaults to the IMAP host on 465 (implicit TLS) — what cPanel advertises. */
export function smtpSettings(conn: Pick<MailConnectionRow, "settings_json">): SmtpCfg | null {
  const imap = conn.settings_json.imap;
  if (conn.settings_json.smtp) return conn.settings_json.smtp;
  if (!imap) return null;
  return { host: imap.host, port: 465, secure: true };
}

async function withImap<T>(conn: MailConnectionRow, password: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const cfg: ImapCfg | undefined = conn.settings_json.imap;
  if (!cfg) throw new Error("IMAP settings missing — connect the mailbox again");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: password },
    logger: false,
    socketTimeout: 45_000,
  });
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string };
    if (e.authenticationFailed) throw new MailAuthError(`Mail server rejected the login: ${e.responseText || "wrong password"}`);
    throw new Error(`Could not reach ${cfg.host}: ${e.message || String(err)}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function smtpTransport(conn: Pick<MailConnectionRow, "settings_json">, password: string) {
  const smtp = smtpSettings(conn);
  const imap = conn.settings_json.imap;
  if (!smtp || !imap) throw new Error("Outgoing mail (SMTP) is not set up for this mailbox");
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: imap.user, pass: password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
}

function smtpError(err: unknown, label: string) {
  const e = err as { code?: string; responseCode?: number; message?: string };
  if (e.code === "EAUTH" || e.responseCode === 535) {
    return new MailAuthError(`Outgoing mail server rejected the login: ${e.message || "wrong password"}`);
  }
  return new Error(`${label}: ${e.message || String(err)}`);
}

/** Check the SMTP login before saving a connection. */
export async function verifySmtp(conn: Pick<MailConnectionRow, "settings_json">, password: string) {
  const transport = smtpTransport(conn, password);
  try {
    await transport.verify();
  } catch (err) {
    throw smtpError(err, "Could not reach the outgoing mail server");
  } finally {
    transport.close();
  }
}

/* ------------------------------------------------------------------ */
/* Folders and refs                                                    */
/* ------------------------------------------------------------------ */

async function folderOf(client: ImapFlow, use: "\\Sent" | "\\Drafts"): Promise<string | null> {
  const boxes: ListResponse[] = await client.list();
  const byUse = boxes.find((b) => b.specialUse === use);
  if (byUse) return byUse.path;
  const names = use === "\\Sent" ? ["sent", "sent items", "sent messages", "inbox.sent"] : ["drafts", "inbox.drafts"];
  return boxes.find((b) => names.includes(b.path.toLowerCase()))?.path || null;
}

export function imapRef(path: string, validity: bigint | number | undefined, uid: number) {
  return `imap:${encodeURIComponent(path)}:${String(validity ?? 0)}:${uid}`;
}

function parseRef(ref: string) {
  const [, path, validity, uid] = ref.split(":");
  return { path: decodeURIComponent(path || "INBOX"), validity: validity || "0", uid: Number(uid) || 0 };
}

/** Locate a message by ref, falling back to its Message-ID if the UID went stale. */
async function locate(client: ImapFlow, ref: string, internetMessageId?: string | null) {
  const { path, validity, uid } = parseRef(ref);
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const box = client.mailbox;
    const current = box && typeof box === "object" ? String(box.uidValidity) : "";
    if (uid && current === validity) {
      const hit = await client.search({ uid: String(uid) }, { uid: true });
      if (hit && hit.length) return { path, uid };
    }
    if (internetMessageId) {
      const found = await client.search({ header: { "message-id": internetMessageId } }, { uid: true });
      if (found && found.length) return { path, uid: found[found.length - 1]! };
    }
    return null;
  } finally {
    lock.release();
  }
}

async function fetchParsed(client: ImapFlow, path: string, uid: number): Promise<ParsedMail | null> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const m = await client.fetchOne(String(uid), { source: { maxLength: FULL_BYTES } }, { uid: true });
    return m && m.source ? await simpleParser(m.source) : null;
  } finally {
    lock.release();
  }
}

/**
 * APPEND with flags. imapflow only keeps flags the *selected* mailbox allows,
 * so select the destination (read-write) first — otherwise a read-only INBOX
 * selection silently drops \Draft / \Seen.
 */
async function appendWithFlags(client: ImapFlow, path: string, raw: Buffer, flags: string[]) {
  const lock = await client.getMailboxLock(path);
  try {
    return await client.append(path, raw, flags);
  } finally {
    lock.release();
  }
}

/* ------------------------------------------------------------------ */
/* Reply: SMTP send + copy to Sent, or save to Drafts                  */
/* ------------------------------------------------------------------ */

const firstAddress = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a[0] : a)?.value?.[0];

function quote(mail: ParsedMail) {
  const from = firstAddress(mail.from);
  const who = from?.name ? `${from.name} <${from.address}>` : from?.address || "";
  const when = mail.date ? mail.date.toUTCString() : "";
  const text = (mail.text || "").replace(/\r/g, "").slice(0, QUOTE_CHARS);
  return `On ${when}, ${who} wrote:\n${text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}`;
}

export type ComposedReply = { raw: Buffer; to: string; messageId: string; subject: string; text: string };

/** Build the exact MIME once: the same bytes are sent and filed in Sent/Drafts. */
export async function composeReply(
  conn: Pick<MailConnectionRow, "email" | "display_name">,
  original: ParsedMail,
  body: string,
): Promise<ComposedReply> {
  const replyTo = firstAddress(original.replyTo) || firstAddress(original.from);
  if (!replyTo?.address) throw new Error("The original mail has no sender address to reply to");
  const refs = Array.isArray(original.references) ? original.references : original.references ? [original.references] : [];
  const references = [...refs, original.messageId].filter((r): r is string => Boolean(r));
  const subject = `Re: ${cleanSubject(original.subject || "")}`;
  const text = `${body.trim()}\n\n${quote(original)}`;
  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const info = await builder.sendMail({
    from: conn.display_name ? { name: conn.display_name, address: conn.email } : conn.email,
    to: replyTo.name ? { name: replyTo.name, address: replyTo.address } : replyTo.address,
    subject,
    inReplyTo: original.messageId || undefined,
    references: references.length ? references : undefined,
    text,
  });
  return {
    raw: info.message as unknown as Buffer,
    to: replyTo.address.toLowerCase(),
    messageId: info.messageId,
    subject,
    text: body.trim(),
  };
}

export type ImapReplyResult =
  | { notFound: true }
  | { notFound: false; mode: "draft"; draftId: string | null; reply: ComposedReply }
  | { notFound: false; mode: "send"; reply: ComposedReply };

export async function replyThroughImap(
  conn: MailConnectionRow,
  password: string,
  opts: { messageId: string; internetMessageId?: string | null; body: string; mode: "send" | "draft"; draftId?: string },
): Promise<ImapReplyResult> {
  return withImap(conn, password, async (client) => {
    const at = await locate(client, opts.messageId, opts.internetMessageId);
    if (!at) return { notFound: true as const };
    const original = await fetchParsed(client, at.path, at.uid);
    if (!original) return { notFound: true as const };
    const reply = await composeReply(conn, original, opts.body);

    const removeDraft = async () => {
      if (!opts.draftId) return;
      const { path, uid } = parseRef(opts.draftId);
      if (!uid) return;
      const lock = await client.getMailboxLock(path);
      try {
        await client.messageDelete(String(uid), { uid: true });
      } catch {
        // already sent or deleted in Outlook
      } finally {
        lock.release();
      }
    };

    if (opts.mode === "draft") {
      const drafts = await folderOf(client, "\\Drafts");
      if (!drafts) throw new Error("This mailbox has no Drafts folder");
      const saved = await appendWithFlags(client, drafts, reply.raw, ["\\Draft", "\\Seen"]);
      await removeDraft();
      const draftId = saved && saved.uid ? imapRef(drafts, saved.uidValidity, saved.uid) : null;
      return { notFound: false as const, mode: "draft" as const, draftId, reply };
    }

    const transport = smtpTransport(conn, password);
    try {
      await transport.sendMail({ envelope: { from: conn.email, to: [reply.to] }, raw: reply.raw });
    } catch (err) {
      throw smtpError(err, "Sending failed");
    } finally {
      transport.close();
    }
    // SMTP doesn't file a copy — do it so the reply shows in Sent everywhere.
    const sent = await folderOf(client, "\\Sent").catch(() => null);
    if (sent) await appendWithFlags(client, sent, reply.raw, ["\\Seen"]).catch(() => undefined);
    await removeDraft();
    return { notFound: false as const, mode: "send" as const, reply };
  });
}
