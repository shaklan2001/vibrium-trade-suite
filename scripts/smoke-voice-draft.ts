/**
 * Smoke test for the voice draft merge (no stutter on interim revisions).
 *   npx tsx scripts/smoke-voice-draft.ts
 */
import assert from "node:assert/strict";
import {
  applyVoiceSegment,
  createVoiceDraftState,
  isTranscriptRevision,
} from "../src/lib/voice/voice-draft";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("id'd interims replace in place, never append", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "From Gurjari", { segmentId: "a" });
  applyVoiceSegment(s, "From Gurga", { segmentId: "a" });
  const out = applyVoiceSegment(s, "From Gurgaon", { segmentId: "a", isFinal: true });
  assert.equal(out, "From Gurgaon");
});

test("separate segment ids concatenate in order", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "Show me", { segmentId: "a", isFinal: true });
  applyVoiceSegment(s, "kalpana deals", { segmentId: "b" });
  const out = applyVoiceSegment(s, "Kalpana's deals", { segmentId: "b", isFinal: true });
  assert.equal(out, "Show me Kalpana's deals");
});

test("id-less interims share one slot", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "what is");
  applyVoiceSegment(s, "what is over");
  const out = applyVoiceSegment(s, "what is overdue");
  assert.equal(out, "what is overdue");
});

test("id-less final replaces revision-like interim", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "how many open");
  const out = applyVoiceSegment(s, "How many open deals?", { isFinal: true });
  assert.equal(out, "How many open deals?");
});

test("id-less final after a final appends new speech", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "Payments due this week.", { isFinal: true });
  const out = applyVoiceSegment(s, "Also list the shipments.", { isFinal: true });
  assert.equal(out, "Payments due this week. Also list the shipments.");
});

test("spelling-correction final revises previous final", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "Deals from Gurjari", { isFinal: true });
  const out = applyVoiceSegment(s, "Deals from Gurgaon", { isFinal: true });
  assert.equal(out, "Deals from Gurgaon");
});

test("data-channel duplicate of an id'd final does not double", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "What needs attention today", { segmentId: "x", isFinal: true });
  const out = applyVoiceSegment(s, "What needs attention today.", { isFinal: true });
  assert.equal(out, "What needs attention today.");
});

test("id'd segment folds an open id-less interim of the same speech", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "open deals for");
  const out = applyVoiceSegment(s, "open deals for Walmart", { segmentId: "z" });
  assert.equal(out, "open deals for Walmart");
});

test("isTranscriptRevision heuristics", () => {
  assert.equal(isTranscriptRevision("hello", "hello"), true);
  assert.equal(isTranscriptRevision("show me", "show me deals"), true);
  assert.equal(isTranscriptRevision("From Gurjari", "From Gurgaon"), true);
  assert.equal(isTranscriptRevision("payments overdue", "list shipments"), false);
  assert.equal(isTranscriptRevision("", "anything"), false);
});

test("blank text is ignored", () => {
  const s = createVoiceDraftState();
  applyVoiceSegment(s, "Hi", { isFinal: true });
  assert.equal(applyVoiceSegment(s, "   "), "Hi");
});

console.log(`\nsmoke-voice-draft: ${passed} passed`);
