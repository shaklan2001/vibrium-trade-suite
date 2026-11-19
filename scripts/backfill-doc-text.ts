/**
 * Turn every attachment already synced from the connected mailboxes into text (document layer, Phase 1).
 * New mail is handled by the sync; this covers mail synced before. Cached by file, so re-runs are cheap.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-doc-text.ts
 *
 * Writes data/docs/backfill.json: counts by status, method and document type.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDocText, wantsText, type StoredFile } from "../src/lib/mail/docStore";
import { extOf, type DocText } from "../src/lib/mail/docText";
import { getMailStore } from "../src/lib/mail/store";
import type { InboxMessageRow } from "../src/lib/mail/types";

async function main() {
  const store = getMailStore();
  const conns = await store.listConnections();
  const ids = conns.map((c) => c.id);
  const keys: string[] = [];
  let before: { at: string; key: string } | null = null;
  for (;;) {
    const page = await store.inboxPage({ connectionIds: ids, limit: 100, before });
    keys.push(...page.threads.map((t) => t.thread_key));
    const last = page.threads[page.threads.length - 1];
    if (!page.has_more || !last) break;
    before = { at: last.last_at, key: last.thread_key };
  }
  const files = new Map<string, StoredFile>();
  const allAtts = new Map<string, StoredFile>();
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < keys.length) {
        const rows: InboxMessageRow[] = await store.threadMessages({ connectionIds: ids, threadKey: keys[next++]!, limit: 100 }).catch(() => []);
        for (const r of rows) {
          for (const a of (r.attachments_json || []) as StoredFile[]) {
            if (!a.sha256 || a.inline || /^image\d*\./i.test(a.name)) continue;
            allAtts.set(a.sha256, a);
            if (wantsText(a)) files.set(a.sha256, a);
          }
        }
      }
    }),
  );
  const byExtAll = [...allAtts.values()].reduce<Record<string, number>>((m, a) => ((m[extOf(a.name) || "?"] = (m[extOf(a.name) || "?"] || 0) + 1), m), {});
  console.log(`${keys.length} conversations · ${allAtts.size} files (not images) · ${files.size} readable formats`, byExtAll);

  const list = [...files.values()];
  const results: DocText[] = [];
  let i = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < list.length) {
        const f = list[i++]!;
        try {
          const d = await ensureDocText(f);
          if (d) results.push(d);
        } catch (err) {
          failed++;
          console.warn("  ✗", f.name, err instanceof Error ? err.message : err);
        }
        if ((results.length + failed) % 50 === 0) console.log(`  ${results.length + failed}/${list.length}`);
      }
    }),
  );
  const count = (f: (d: DocText) => string) => results.reduce<Record<string, number>>((m, d) => ((m[f(d)] = (m[f(d)] || 0) + 1), m), {});
  const out = {
    generatedAt: new Date().toISOString(),
    conversations: keys.length,
    files: allAtts.size,
    filesByExt: byExtAll,
    readableFormats: files.size,
    processed: results.length,
    errors: failed,
    byStatus: count((d) => d.status),
    byMethod: count((d) => `${d.method}:${d.status}`),
    byType: count((d) => (d.status === "ok" ? d.docType : `(${d.status})`)),
    avgChars: Math.round(results.filter((d) => d.status === "ok").reduce((s, d) => s + d.text.length, 0) / Math.max(1, results.filter((d) => d.status === "ok").length)),
  };
  await mkdir(path.join(process.cwd(), "data", "docs"), { recursive: true });
  await writeFile(path.join(process.cwd(), "data", "docs", "backfill.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
