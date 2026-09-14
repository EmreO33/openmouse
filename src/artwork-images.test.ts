import assert from "node:assert/strict";
import test from "node:test";
import { parseArtworkImage } from "../functions/api/_lib/images.js";
import {
  aiScreeningLabel,
  claimScreeningSlot,
  parseScore,
  parseVerdict,
  screeningDecision,
} from "../functions/api/artwork.js";

const noVerify = async () => null;

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function verdictOf({ device = true, nsfw = 0, hate = 0, gore = 0, unrelated = 0 } = {}) {
  return { device, issues: { nsfw, hate, gore }, unrelated };
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[8] = 0;
  bytes[9] = 0;
  bytes[10] = 0;
  bytes[11] = 13;
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function webpVp8lBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(25);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  bytes[20] = 0x2f;
  const bits = (width - 1) & 0x3fff | (((height - 1) & 0x3fff) << 14);
  bytes[21] = bits & 0xff;
  bytes[22] = (bits >>> 8) & 0xff;
  bytes[23] = (bits >>> 16) & 0xff;
  bytes[24] = (bits >>> 24) & 0xff;
  return bytes;
}

test("parseArtworkImage reads PNG dimensions from the IHDR chunk", () => {
  const info = parseArtworkImage(pngBytes(512, 256));
  assert.deepEqual(info, { format: "png", width: 512, height: 256 });
});

test("parseArtworkImage reads WebP lossless dimensions", () => {
  const info = parseArtworkImage(webpVp8lBytes(40, 40));
  assert.deepEqual(info, { format: "webp", width: 40, height: 40 });
});

test("parseArtworkImage rejects non-image bytes", () => {
  assert.equal(parseArtworkImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
  assert.equal(parseArtworkImage(new Uint8Array(0)), null);
});

test("parseArtworkImage rejects out-of-range dimensions", () => {
  assert.equal(parseArtworkImage(pngBytes(10, 10)), null);
  assert.equal(parseArtworkImage(pngBytes(90000, 100)), null);
  assert.equal(parseArtworkImage(pngBytes(9000, 9000)), null);
});

test("parseVerdict extracts scores from a bare model response", () => {
  const text = '{"device": true, "issues": {"nsfw": 0.0, "hate": 0.0, "gore": 0.0}, "unrelated": 0.0}';
  assert.deepEqual(parseVerdict(text), {
    device: true,
    issues: { nsfw: 0, hate: 0, gore: 0 },
    unrelated: 0,
  });
});

test("parseVerdict strips code fences and clamps out-of-range scores", () => {
  const text = 'Here:\n```json\n{"device": false, "issues": {"nsfw": 1.4, "hate": -3, "gore": 0.2}, "unrelated": "0.9"}\n```\nDone.';
  assert.deepEqual(parseVerdict(text), {
    device: false,
    issues: { nsfw: 1, hate: 0, gore: 0.2 },
    unrelated: 0.9,
  });
});

test("parseVerdict returns null for non-JSON output", () => {
  assert.equal(parseVerdict("I cannot review this image."), null);
  assert.equal(parseVerdict(""), null);
});

test("parseScore reads a verification score and rejects noise", () => {
  assert.equal(parseScore('{"score": 0.93}'), 0.93);
  assert.equal(parseScore('Sure:\n{"score": 0.5}\n'), 0.5);
  assert.equal(parseScore("I won't review this."), null);
});

test("screeningDecision approves clean artwork", async () => {
  assert.deepEqual(await screeningDecision(verdictOf(), noVerify), { action: "approve", reasons: [] });
});

test("screeningDecision rejects a hard category only when the independent pass confirms it", async () => {
  const verdict = verdictOf({ nsfw: 0.95 });
  assert.deepEqual(await screeningDecision(verdict, async () => 0.93), {
    action: "reject",
    reason: "nsfw",
  });
  assert.deepEqual(await screeningDecision(verdict, async () => 0.2), {
    action: "flag",
    reasons: ["disputed:nsfw"],
  });
  assert.deepEqual(await screeningDecision(verdict, noVerify), {
    action: "flag",
    reasons: ["disputed:nsfw"],
  });
});

test("screeningDecision picks the top hard category by score", async () => {
  const verdict = verdictOf({ nsfw: 0.3, hate: 0.97, gore: 0.9 });
  const confirmed = await screeningDecision(verdict, async () => 0.97);
  assert.equal(confirmed.action, "reject");
  assert.equal(confirmed.reason, "hate");
});

test("screeningDecision rejects junk only when unrelated is high, not a device, and confirmed", async () => {
  const verdict = verdictOf({ device: false, unrelated: 0.95 });
  assert.deepEqual(await screeningDecision(verdict, async () => 0.96), {
    action: "reject",
    reason: "junk",
  });
  assert.deepEqual(await screeningDecision(verdict, async () => 0.5), {
    action: "flag",
    reasons: ["disputed:unrelated"],
  });
});

test("screeningDecision approves through a weak unrelated signal while a moderate one flags for review", async () => {
  const verdict = verdictOf({ device: true, unrelated: 0.4 });
  assert.deepEqual(await screeningDecision(verdict, async () => 0.4), {
    action: "approve",
    reasons: [],
  });
  const flagVerdict = verdictOf({ device: true, unrelated: 0.6 });
  assert.deepEqual(await screeningDecision(flagVerdict, noVerify), {
    action: "flag",
    reasons: ["unrelated"],
  });
});

test("screeningDecision flags, never blocks, a missing device read", async () => {
  const verdict = verdictOf({ device: false, unrelated: 0.3 });
  const decision = await screeningDecision(verdict, noVerify);
  assert.equal(decision.action, "flag");
  assert.notEqual(decision.reason, "junk");
});

test("screeningDecision flags moderate hard-category scores for the review queue", async () => {
  const verdict = verdictOf({ nsfw: 0.55 });
  assert.deepEqual(await screeningDecision(verdict, noVerify), {
    action: "flag",
    reasons: ["nsfw"],
  });
});

test("screeningDecision flags a missing verdict rather than dropping it", async () => {
  assert.deepEqual(await screeningDecision(null, noVerify), {
    action: "flag",
    reasons: ["no-verdict"],
  });
});

test("claimScreeningSlot consumes slots and stops at the configured budget", async () => {
  const env = { SECURITY_KV: new FakeKV(), SCREENING_BUDGET: "2" };
  assert.equal(await claimScreeningSlot(env), true);
  assert.equal(await claimScreeningSlot(env), true);
  assert.equal(await claimScreeningSlot(env), false);
});

test("claimScreeningSlot counts by day, not forever", async () => {
  const kv = new FakeKV();
  const env = { SECURITY_KV: kv, SCREENING_BUDGET: "1" };
  assert.equal(await claimScreeningSlot(env), true);
  assert.equal(await claimScreeningSlot(env), false);
  const [key] = [...kv.store.keys()];
  assert.match(key ?? "", /^ai-screen:\d{4}-\d{2}-\d{2}$/);
});

test("claimScreeningSlot disables screening when the budget is zero", async () => {
  const env = { SECURITY_KV: new FakeKV(), SCREENING_BUDGET: "0" };
  assert.equal(await claimScreeningSlot(env), false);
});

test("claimScreeningSlot fails open without KV storage", async () => {
  const env = { SCREENING_BUDGET: "5" };
  assert.equal(await claimScreeningSlot(env), true);
});

test("claimScreeningSlot fails open on storage errors", async () => {
  const kv = {
    get: async () => {
      throw new Error("kv down");
    },
    put: async () => {
      throw new Error("kv down");
    },
  };
  const env = { SECURITY_KV: kv, SCREENING_BUDGET: "5" };
  assert.equal(await claimScreeningSlot(env), true);
});

test("aiScreeningLabel describes every handling path", () => {
  assert.equal(aiScreeningLabel(false, null), "Not screened (AI unavailable)");
  assert.equal(aiScreeningLabel(true, null), "Unclear — manual review requested");
  assert.equal(aiScreeningLabel(true, { action: "skip" }), "Not screened (daily AI budget reached)");
  assert.equal(aiScreeningLabel(true, { action: "approve" }), "Auto-approved by AI");
  assert.equal(
    aiScreeningLabel(true, { action: "flag", reasons: ["nsfw", "unrelated"] }),
    "Flagged for review — nsfw, unrelated",
  );
});