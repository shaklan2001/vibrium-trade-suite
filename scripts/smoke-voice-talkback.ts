/**
 * Smoke test for talkback text cleaning (markdown → speakable prose).
 *   npx tsx scripts/smoke-voice-talkback.ts
 */
import assert from "node:assert/strict";
import { chunkForSpeech, toSpeakableText } from "../src/lib/voice/voice-talkback";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("strips headings, bold, italics, inline code", () => {
  const out = toSpeakableText("## Summary\n**3 deals** are _overdue_ — see `D-102`.");
  assert.equal(out, "Summary. 3 deals are overdue — see D-102.");
});

test("drops tables and code fences", () => {
  const md = [
    "Here is the book:",
    "",
    "| Deal | Status |",
    "|------|--------|",
    "| D-1 | Open |",
    "",
    "```json",
    '{ "a": 1 }',
    "```",
    "That's all.",
  ].join("\n");
  assert.equal(toSpeakableText(md), "Here is the book: That's all.");
});

test("links keep text, images and urls vanish", () => {
  const out = toSpeakableText("Open [the deal](https://x.io/d/1) ![chart](c.png) or https://x.io");
  assert.equal(out, "Open the deal or.");
});

test("list markers removed, each item gets a pause", () => {
  const out = toSpeakableText("Next steps\n- Chase payment\n- Book container\n1. Send PI");
  assert.equal(out, "Next steps. Chase payment. Book container. Send PI.");
});

test("html entities decoded", () => {
  assert.equal(toSpeakableText("A &amp; B &lt;ok&gt;"), "A & B <ok>.");
});

test("long replies clamp at a sentence boundary", () => {
  const md = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const out = toSpeakableText(md, 200);
  assert.ok(out.length <= 200, `length ${out.length}`);
  assert.ok(out.endsWith("."), out);
});

test("chunkForSpeech keeps chunks short and lossless", () => {
  const text = Array.from({ length: 20 }, (_, i) => `Item ${i} is fine.`).join(" ");
  const chunks = chunkForSpeech(text, 80);
  assert.ok(chunks.every((c) => c.length <= 80));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text);
});

test("empty input", () => {
  assert.equal(toSpeakableText(""), "");
});

console.log(`\nsmoke-voice-talkback: ${passed} passed`);
