import assert from "node:assert/strict";
import { isDead, isLiveDealRow, withinYear } from "../src/lib/mail/viewWindow";

const now = Date.parse("2026-11-25T00:00:00Z");
const ago = (d: number) => new Date(now - d * 86400000).toISOString();

// year view: newest first, the list stops at the first thread older than a year
const r = withinYear([{ last_at: ago(2) }, { last_at: ago(300) }, { last_at: ago(400) }, { last_at: ago(500) }], now);
assert.equal(r.kept.length, 2);
assert.equal(r.done, true);
assert.equal(withinYear([{ last_at: ago(2) }, { last_at: ago(364) }], now).done, false);

// dead: quiet 6 months, mail threads and deals alike
assert.equal(isDead(ago(200), now), true);
assert.equal(isDead(ago(170), now), false);
assert.equal(isDead(ago(1), now), false);
assert.equal(isLiveDealRow({ date_end: ago(200) }, now), false);
assert.equal(isLiveDealRow({ date_end: ago(30) }, now), true);
assert.equal(isLiveDealRow({ date_end: null, processed_at: ago(300) }, now), false);
assert.equal(isLiveDealRow({}, now), true);
console.log("view window: 9 checks pass");
