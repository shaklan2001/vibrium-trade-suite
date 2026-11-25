import { ImapFlow, type MailboxLockObject } from "imapflow";
import type { MailConnectionSettings } from "../types";
import { MailAuthError } from "./http";
import { beforeInclusive, laterOf } from "../syncWindow";
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
    async listSince(since, cap, before) {
      const folders = ["INBOX"];
      const boxes = await client.list();
      const sent = boxes.find((b) => b.specialUse === "\\Sent");
      if (sent && sent.path !== "INBOX") folders.push(sent.path);
      // The inbox gets most of the room; the sent folder keeps a share so replies are never crowded out.
      const sentShare = folders.length > 1 ? Math.floor(cap * 0.2) : 0;

      const refs: ProviderRef[] = [];
      let truncatedAt: Date | null = null;
      for (const [i, path] of folders.entries()) {
        await open(path);
        const box = client.mailbox;
        const validity = box && typeof box === "object" ? box.uidValidity : 0;
        const query = before ? { since, before: beforeInclusive(before) } : { since };
        const uids = ((await client.search(query, { uid: true })) || []).sort((a, b) => a - b);
        const room = i === 0 ? cap - sentShare : cap - refs.length;
        const kept = uids.length > room ? uids.slice(uids.length - Math.max(room, 0)) : uids;
        if (kept.length < uids.length && kept.length) {
          // Where the cut fell: the received date of the oldest message kept.
          const m = await client.fetchOne(String(kept[0]), { internalDate: true }, { uid: true });
          const d = m && m.internalDate ? new Date(m.internalDate) : null;
          truncatedAt = laterOf(truncatedAt, d || since);
        }
        for (const uid of kept) refs.push({ id: refId(path, validity, uid) });
      }
      return { refs, truncatedAt };
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
