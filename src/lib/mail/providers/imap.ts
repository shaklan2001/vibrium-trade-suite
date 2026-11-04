import { ImapFlow, type MailboxLockObject } from "imapflow";
import type { MailConnectionSettings } from "../types";
import { MailAuthError } from "./http";
import type { OpenSession, ProviderRef } from "./types";

type ImapSettings = NonNullable<MailConnectionSettings["imap"]>;

function makeClient(cfg: ImapSettings, password: string) {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: password },
    logger: false,
    socketTimeout: 60_000,
  });
}

async function connect(cfg: ImapSettings, password: string) {
  const client = makeClient(cfg, password);
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string };
    if (e.authenticationFailed) {
      throw new MailAuthError(`IMAP login rejected: ${e.responseText || "check user / app password"}`);
    }
    throw new Error(`IMAP connect failed: ${e.message || String(err)}`);
  }
  return client;
}

/** Validate credentials before saving a connection. */
export async function verifyImap(cfg: ImapSettings, password: string) {
  const client = await connect(cfg, password);
  await client.logout().catch(() => undefined);
}

function refId(path: string, uidValidity: bigint | number | string, uid: number) {
  return `imap:${encodeURIComponent(path)}:${String(uidValidity)}:${uid}`;
}

function parseRef(id: string) {
  const [, path, validity, uid] = id.split(":");
  return { path: decodeURIComponent(path || ""), validity, uid: Number(uid) };
}

export const openImapSession: OpenSession = async (conn, secret) => {
  const cfg = conn.settings_json.imap;
  if (!cfg) throw new Error("IMAP settings missing");
  if (secret.kind !== "password") throw new MailAuthError("IMAP password missing");
  const client = await connect(cfg, secret.password);

  let lock: MailboxLockObject | null = null;
  let lockPath = "";
  async function open(path: string) {
    if (lock && lockPath === path) return;
    lock?.release();
    lock = await client.getMailboxLock(path, { readOnly: true });
    lockPath = path;
  }

  return {
    secret,
    secretChanged: false,
    async listSince(since, cap) {
      const folders = ["INBOX"];
      const boxes = await client.list();
      const sent = boxes.find((b) => b.specialUse === "\\Sent");
      if (sent && sent.path !== "INBOX") folders.push(sent.path);

      const refs: ProviderRef[] = [];
      for (const path of folders) {
        await open(path);
        const box = client.mailbox;
        const validity = box && typeof box === "object" ? box.uidValidity : 0;
        const uids = (await client.search({ since }, { uid: true })) || [];
        for (const uid of uids) refs.push({ id: refId(path, validity, uid) });
        if (refs.length >= cap) break;
      }
      return refs.slice(0, cap);
    },
    async fetchRaw(ref) {
      const { path, uid } = parseRef(ref.id);
      if (!path || !uid) return null;
      await open(path);
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      return msg && msg.source ? Buffer.from(msg.source) : null;
    },
    async close() {
      try {
        (lock as MailboxLockObject | null)?.release();
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
};

/** Presets for the connect form. */
export const IMAP_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail: { host: "imap.gmail.com", port: 993, secure: true },
  outlook: { host: "outlook.office365.com", port: 993, secure: true },
  yahoo: { host: "imap.mail.yahoo.com", port: 993, secure: true },
  zoho: { host: "imap.zoho.in", port: 993, secure: true },
  godaddy: { host: "imap.secureserver.net", port: 993, secure: true },
};
