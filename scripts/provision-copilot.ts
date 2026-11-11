/**
 * Sync the Ops Copilot persona (src/lib/trade/opsCopilotPersona.ts) to the
 * live Vibrium bot.
 *
 *   npm run provision:copilot                         # dry run — compare live vs repo
 *   npm run provision:copilot -- --apply              # back up live persona, then update
 *   npm run provision:copilot -- --restore <file.md>  # put a backed-up persona back
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  OPS_COPILOT_DESCRIPTION,
  OPS_COPILOT_PERSONA,
} from "../src/lib/trade/opsCopilotPersona";

const API = (process.env.VIBRIUM_API_BASE_URL || "").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID || "";
const USER = process.env.VIBRIUM_SERVICE_USERNAME || "";
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD || "";
const BOT = process.env.VIBRIUM_OPS_COPILOT_BOT_ID || "VB00000001";

async function mint(): Promise<string> {
  const basic = Buffer.from(`${USER}:${PASS}`).toString("base64");
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/auth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const json = (await res.json()) as { data?: { token?: string }; token?: string };
  const token = json.data?.token || json.token;
  if (!token) throw new Error(`auth failed (${res.status})`);
  return token;
}

async function getBot(token: string) {
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/voice-bots/${BOT}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET bot failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as {
    data?: { result?: { bot?: Record<string, unknown> & { persona?: string; description?: string } } };
  };
  const bot = json.data?.result?.bot;
  if (!bot) throw new Error("bot not found in response");
  return bot;
}

async function patchBot(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/voice-bots/${BOT}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH bot failed (${res.status}): ${text.slice(0, 500)}`);
  return text;
}

function summarizeDiff(live: string, next: string) {
  const a = live.split("\n");
  const b = next.split("\n");
  const removed = a.filter((l) => !b.includes(l)).length;
  const added = b.filter((l) => !a.includes(l)).length;
  return `live ${live.length} chars / ${a.length} lines → repo ${next.length} chars / ${b.length} lines (${removed} lines removed, ${added} added)`;
}

async function main() {
  if (!API || !CUSTOMER || !USER || !PASS) {
    throw new Error("Set VIBRIUM_API_BASE_URL, VIBRIUM_CUSTOMER_ID, VIBRIUM_SERVICE_USERNAME, VIBRIUM_SERVICE_PASSWORD");
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const restoreIdx = args.indexOf("--restore");
  const restoreFile = restoreIdx >= 0 ? args[restoreIdx + 1] : undefined;

  const token = await mint();
  const bot = await getBot(token);
  const live = bot.persona || "";
  const next = restoreFile ? readFileSync(restoreFile, "utf8") : OPS_COPILOT_PERSONA;

  console.log(`Bot ${BOT}: ${summarizeDiff(live, next)}`);
  if (live === next) {
    console.log("Already in sync — nothing to do.");
    return;
  }
  if (!apply && !restoreFile) {
    console.log("Dry run. Re-run with --apply to back up the live persona and update the bot.");
    return;
  }

  const dir = path.join(process.cwd(), "data", "copilot-persona-backups");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${BOT}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(backup, live);
  console.log(`Backed up live persona → ${backup}`);

  // The bot API validates the whole bot on PATCH, so send every current field
  // back unchanged and swap only persona/description. Read-only fields are dropped.
  const READ_ONLY = new Set(["id", "created_at", "updated_at", "created_by", "updated_by", "total_calls", "last_qa_run"]);
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bot)) {
    if (!READ_ONLY.has(k) && v !== null) body[k] = v;
  }
  body.persona = next;
  if (!restoreFile) body.description = OPS_COPILOT_DESCRIPTION;
  writeFileSync(backup.replace(/\.md$/, ".json"), JSON.stringify(bot, null, 2));

  // The platform accepts the update (202) and applies it in a background
  // handler, which also regenerates the greeting (first_message) per language.
  await patchBot(token, body);
  let after = await getBot(token);
  for (let i = 0; i < 20 && (after.persona || "") !== next; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    after = await getBot(token);
  }
  if ((after.persona || "") !== next) {
    throw new Error("Update accepted but not applied after 60s — check the bot's history on Vibrium.");
  }
  // Everything except persona/description/timestamps must be untouched.
  const changed = Object.keys({ ...bot, ...after }).filter(
    (k) =>
      !["persona", "description", "updated_at", "updated_by", "total_calls", "platform_language_configs"].includes(k) &&
      JSON.stringify(bot[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
  if (changed.length) {
    console.warn(`WARNING: other bot fields changed: ${changed.join(", ")} — full backup: ${backup.replace(/\.md$/, ".json")}`);
  }
  console.log(`Updated ${BOT}. Restore with: npm run provision:copilot -- --restore ${backup}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
