#!/usr/bin/env node
/**
 * Provision / upgrade all Trade suite worker agents (Phase A–G).
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-workers.mjs
 *   node --env-file=.env.local scripts/provision-workers.mjs --upgrade
 *   node --env-file=.env.local scripts/provision-workers.mjs --phase bg
 *
 * Writes scripts/agent-ids.json with the slot → agent_id map.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = (process.env.VIBRIUM_API_BASE_URL || "https://api-staging.vibrium.ai").replace(/\/$/, "");
const CUSTOMER = process.env.VIBRIUM_CUSTOMER_ID;
const USER = process.env.VIBRIUM_SERVICE_USERNAME;
const PASS = process.env.VIBRIUM_SERVICE_PASSWORD;
const UPGRADE = process.argv.includes("--upgrade");
const PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i >= 0 ? process.argv[i + 1] : "all";
})();

if (!API || !CUSTOMER || !USER || !PASS) {
  console.error("Missing VIBRIUM_* env");
  process.exit(1);
}

const ALL = JSON.parse(
  readFileSync(join(__dirname, "worker-specs.json"), "utf8"),
);

const PHASE_A = ["requirement_extractor", "quote_normalizer"];
const PHASE_BG = Object.keys(ALL).filter((k) => !PHASE_A.includes(k));

let slots =
  PHASE === "a" ? PHASE_A : PHASE === "bg" ? PHASE_BG : Object.keys(ALL);

const idMapPath = join(__dirname, "agent-ids.json");
let existing = {};
try {
  existing = JSON.parse(readFileSync(idMapPath, "utf8"));
} catch {
  /* first run */
}

existing.requirement_extractor =
  existing.requirement_extractor ||
  process.env.NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR ||
  "AA00000025";
existing.quote_normalizer =
  existing.quote_normalizer ||
  process.env.NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER ||
  "AA00000026";

async function mint() {
  const basic = Buffer.from(`${USER}:${PASS}`).toString("base64");
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/auth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const json = await res.json();
  const token = json.data?.token || json.token;
  if (!token) throw new Error(`auth failed ${res.status}`);
  return token;
}

async function create(token, body) {
  const res = await fetch(`${API}/v1/customers/${CUSTOMER}/agents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    throw new Error(`create failed ${res.status}`);
  }
  return json.data?.agent || json.agent || json.data || json;
}

async function patch(token, agentId, body) {
  const res = await fetch(
    `${API}/v1/customers/${CUSTOMER}/agents/${encodeURIComponent(agentId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    throw new Error(`patch ${agentId} failed ${res.status}`);
  }
  return json.data?.agent || json.agent || json.data || json;
}

const token = await mint();
const out = { ...existing };

for (const slot of slots) {
  const spec = ALL[slot];
  if (!spec) {
    console.warn("skip unknown", slot);
    continue;
  }
  if (out[slot] && UPGRADE) {
    process.stdout.write(`upgrade ${slot} ${out[slot]}… `);
    await patch(token, out[slot], spec);
    console.log("ok");
  } else if (out[slot]) {
    console.log(`keep ${slot} ${out[slot]}`);
  } else {
    process.stdout.write(`create ${slot}… `);
    const agent = await create(token, spec);
    const id = agent.agent_id || agent.bot_id;
    out[slot] = id;
    console.log(id);
  }
}

writeFileSync(idMapPath, JSON.stringify(out, null, 2) + "\n");
console.log("\nWrote", idMapPath);
console.log(JSON.stringify(out, null, 2));
