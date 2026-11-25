import assert from "node:assert/strict";
import { isDead, withinYear } from "../src/lib/mail/viewWindow";

const now = Date.parse("2026-11-25T00:00:00Z");
const ago = (d: number) => new Date(now - d * 86400000).toISOString();

// year view: newest first, the list stops at the first thread older than a year
const r = withinYear([{ last_at: ago(2) }, { last_at: ago(300) }, { last_at: ago(400) }, { last_at: ago(500) }], now);
assert.equal(r.kept.length, 2);
assert.equal(r.done, true);
assert.equal(withinYear([{ last_at: ago(2) }, { last_at: ago(364) }], now).done, false);

// dead: no deal + quiet 6 months. A deal keeps the thread for the year.
assert.equal(isDead(ago(200), false, now), true);
assert.equal(isDead(ago(170), false, now), false);
assert.equal(isDead(ago(200), true, now), false);
assert.equal(isDead(ago(1), false, now), false);
console.log("view window: 4 checks pass");
