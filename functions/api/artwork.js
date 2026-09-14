// Artwork submission relay with image screening.
//
// The artwork dialog POSTs a multipart form (payload_json + files[0]) to this
// endpoint. Before anything reaches Discord it:
//   1. structurally validates the image (magic bytes + sane dimensions),
//   2. screens the content with a Workers AI vision model when the `AI`
//      binding is configured,
//   3. relays approved images to the same Discord webhook as feedback.
//
// Screening philosophy — a vision model is probabilistic, so every decision
// defaults toward the human review queue:
//   - Hard categories (nsfw / hate / gore) are each scored 0..1. They only
//     auto-block when the score is high AND an independent second pass
//     confirms it. Anything between background and high is flagged, never
//     blocked.
//   - "Unrelated / junk" is the most subjective call, so it needs the highest
//     bar of all and the same double confirmation before it can block.
//   - Refusals, unparseable output, or screening failures are treated as
//     "needs review" and forwarded with a flag — a botched call can never
//     silently swallow a legitimate submission.
//
// Env:
//   DISCORD_FEEDBACK_WEBHOOK — webhook for the review channel (required)
//   AI                        — Workers AI binding (optional; screening is
//                                skipped entirely if the binding is absent,
//                                mirroring how the security middleware never
//                                breaks on a missing KV binding)
//   SCREENING_BUDGET          — max AI screenings per day (default 200;
//                                uses SECURITY_KV to count; 0 disables AI
//                                entirely while still allowing uploads)
// The screening model (@cf/meta/llama-3.2-11b-vision-instruct) requires
// accepting the Meta license once per account before first use.

import { parseArtworkImage } from "./_lib/images.js";

const MAX_ART_SIZE = 5 * 1024 * 1024;
const SCREENING_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
// Keeps the account comfortably inside Workers AI's daily free allocation
// (~10,000 neurons; the 11B vision model costs roughly 20-60 neurons per
// call), so a well-meaning spike or a spam run can never turn into a bill.
// Overridable per project with the SCREENING_BUDGET env var.
const DEFAULT_SCREENING_BUDGET = 200;

const HARD_CATEGORIES = ["nsfw", "hate", "gore"];

// Above this the category is treated as auto-block material — but only after
// the independent verification pass agrees above the same threshold.
const HARD_BLOCK_THRESHOLD = 0.85;
// At or above this the category is flagged for the review queue.
const HARD_FLAG_THRESHOLD = 0.4;
// "Not device imagery at all" needs the highest bar before it can block.
const JUNK_BLOCK_THRESHOLD = 0.9;
const JUNK_BLOCK_VERIFY_THRESHOLD = 0.95;

const VERIFY_DESCRIPTIONS = {
  nsfw: "nudity, sexually explicit, or sexualized content",
  hate: "hate symbols, slurs, or targeted abuse",
  gore: "gore, graphic violence, or injury",
  junk: "content that is not device product imagery at all (meme, screenshot, random photo, a person, text-only, or blank image)",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function budgetDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Claims one AI screening slot for today's budget. Returns true when a slot
    exists (consuming it), false when the daily budget is exhausted or AI is
    disabled via SCREENING_BUDGET=0. Storage failures fail OPEN — the upload
    is screened anyway rather than wrongly held up. */
export async function claimScreeningSlot(env) {
  const budget = Number(env.SCREENING_BUDGET ?? DEFAULT_SCREENING_BUDGET);
  if (!Number.isFinite(budget) || budget <= 0) return false;
  const kv = env.SECURITY_KV;
  if (!kv) return true;
  try {
    const key = `ai-screen:${budgetDate()}`;
    const used = Number((await kv.get(key)) ?? "0");
    if (used >= budget) return false;
    await kv.put(key, String(used + 1), { expirationTtl: 3 * 24 * 3600 });
    return true;
  } catch {
    return true;
  }
}

const SCREENING_SYSTEM_PROMPT = `
You are the content-safety reviewer for an open-source app whose catalog shows
top-down product artwork (cutouts) of computer mice and peripherals. A user
submitted the attached image as the product artwork for a device listing.

This is a review gate, not a censorship gate. Be conservative: when you are
uncertain, output LOW scores. Legitimate images include product cutouts,
product renders, product photos, and clean marketing/diagram images — even
when the background is busy, the crop is imperfect, or a brand logo is
visible. Only score these problems when they are actually present:
- "nsfw": nudity, sexually explicit, or sexualized content
- "hate": hate symbols, slurs, or targeted abuse (including text drawn on the image)
- "gore": gore, graphic violence, or injury
- "unrelated": the image clearly is not a depiction of the device at all
  (a meme, a screenshot, a random photo, a person, text-only, or a blank image)

Respond with ONLY a JSON object and no commentary, using this exact schema:
{"device": true, "issues": {"nsfw": 0.0, "hate": 0.0, "gore": 0.0}, "unrelated": 0.0}

"device" is true when the image plausibly depicts the submitted device or
similar hardware. Every score is a confidence 0..1 that the issue is present;
use 0.0 when absent, and always prefer lower scores when unsure.
`.trim();

/** Pulls the verdict JSON out of a model response that may carry fences or
    surrounding prose. Returns null when no usable object is present. */
export function parseVerdict(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    const issuesRaw = data.issues && typeof data.issues === "object" ? data.issues : {};
    return {
      device: typeof data.device === "boolean" ? data.device : null,
      issues: {
        nsfw: clamp01(issuesRaw.nsfw),
        hate: clamp01(issuesRaw.hate),
        gore: clamp01(issuesRaw.gore),
      },
      unrelated: clamp01(data.unrelated),
    };
  } catch {
    return null;
  }
}

/** Pulls a single 0..1 score out of a verification-pass JSON response
    ({"score": n}). Returns null when the model did not return one. */
export function parseScore(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/"score"\s*:\s*([\d.]+)/);
  return match ? clamp01(match[1]) : null;
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * Decides what to do with a screening verdict. `verify(category)` runs the
 * follow-up confirmation pass and returns a 0..1 score (or null on failure);
 * it is injected so the endpoint can pass the real model call and tests can
 * pass a controlled one.
 *
 * Returns one of:
 *   { action: "approve" }
 *   { action: "flag", reasons: [...] }    — forwarded to the review queue
 *   { action: "reject", reason }          — blocked (only the hard categories)
 */
export async function screeningDecision(verdict, verify = async () => null) {
  if (!verdict) return { action: "flag", reasons: ["no-verdict"] };

  const top = HARD_CATEGORIES.map((category) => ({ category, score: verdict.issues[category] }))
    .sort((a, b) => b.score - a.score)[0];

  if (top.score >= HARD_BLOCK_THRESHOLD) {
    const confirmed = await verify(top.category);
    if (confirmed !== null && confirmed >= HARD_BLOCK_THRESHOLD) {
      return { action: "reject", reason: top.category };
    }
    return { action: "flag", reasons: [`disputed:${top.category}`] };
  }

  if (verdict.device === false && verdict.unrelated >= JUNK_BLOCK_THRESHOLD) {
    const confirmed = await verify("junk");
    if (confirmed !== null && confirmed >= JUNK_BLOCK_VERIFY_THRESHOLD) {
      return { action: "reject", reason: "junk" };
    }
    return { action: "flag", reasons: ["disputed:unrelated"] };
  }

  if (top.score >= HARD_FLAG_THRESHOLD || verdict.device === false || verdict.unrelated >= 0.5) {
    const reasons = [];
    for (const { category, score } of HARD_CATEGORIES.map((category) => ({ category, score: verdict.issues[category] }))) {
      if (score >= HARD_FLAG_THRESHOLD) reasons.push(category);
    }
    if (verdict.unrelated >= 0.5) reasons.push("unrelated");
    return { action: "flag", reasons };
  }

  return { action: "approve", reasons: [] };
}

/** Discord embed label describing how the image was handled. */
export function aiScreeningLabel(envAiAvailable, decision) {
  if (!envAiAvailable) return "Not screened (AI unavailable)";
  if (!decision) return "Unclear — manual review requested";
  if (decision.action === "skip") return "Not screened (daily AI budget reached)";
  if (decision.action === "approve") return "Auto-approved by AI";
  if (decision.action === "flag") {
    return `Flagged for review — ${(decision.reasons ?? []).join(", ")}`;
  }
  return "Unclear — manual review requested";
}

function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function dataUrl(bytes, format) {
  return `data:image/${format};base64,${toBase64(bytes)}`;
}

async function runVision(env, bytes, format, systemPrompt, userPrompt) {
  const response = await env.AI.run(SCREENING_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    image: dataUrl(bytes, format),
  });
  // Workers AI sometimes returns `response` as a string (needing our own JSON
  // extraction below) and sometimes as an already-parsed object when the
  // model's output happened to be clean JSON — handle both.
  const inner = response && typeof response === "object" ? response.response : response;
  if (typeof inner === "string") return inner;
  if (inner && typeof inner === "object") return JSON.stringify(inner);
  return String(inner ?? "");
}

/** First pass — full scored classification of the image. */
async function screenImage(env, bytes, format) {
  const raw = await runVision(env, bytes, format, SCREENING_SYSTEM_PROMPT, "Review this image and output the requested JSON only.");
  return parseVerdict(raw);
}

/** Independent second pass — confirms one specific suspicion before any block. */
async function verifyCategory(env, bytes, format, category) {
  const prompt = `You are an independent second reviewer for image content safety. A first review flagged this image for "${category}". Do NOT trust that flag — verify it yourself. Report a single confidence 0..1 that the image genuinely contains ${VERIFY_DESCRIPTIONS[category] ?? category}. When unsure, output a low score. Reply with ONLY a JSON object {"score": n}.`;
  return parseScore(await runVision(env, bytes, format, prompt, "Verify independently and output the requested JSON only."));
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);

  const webhook = env.DISCORD_FEEDBACK_WEBHOOK;
  if (!webhook || !webhook.startsWith("https://discord")) {
    return json({ message: "Artwork submissions are not configured." }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const file = form.get("files[0]");
  if (!(file instanceof File)) return json({ ok: false, reason: "invalid" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_ART_SIZE) {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const info = parseArtworkImage(bytes);
  if (!info) return json({ ok: false, reason: "invalid" }, 422);

  let decision = null;
  let aiSkippedByBudget = false;
  if (env.AI) {
    // Screening failures fail open (structural checks above still apply) and
    // forward flagged for review — a misbehaving model never blocks a
    // legitimate submission. Once the daily budget is used up (or set to 0),
    // screening is skipped entirely: uploads still flow through, unscreened.
    decision = await (async () => {
      if (!(await claimScreeningSlot(env))) {
        aiSkippedByBudget = true;
        return { action: "skip" };
      }
      const verdict = await screenImage(env, bytes, info.format).catch((err) => {
        console.error("artwork screening: screenImage failed", err && err.stack ? err.stack : err);
        return null;
      });
      if (!verdict) console.error("artwork screening: no verdict parsed from model response");
      return screeningDecision(verdict, (category) =>
        claimScreeningSlot(env).then(
          (allowed) => (allowed ? verifyCategory(env, bytes, info.format, category).catch(() => null) : null),
        ),
      );
    })();
    if (decision.action === "reject") return json({ ok: false, reason: decision.reason }, 422);
  }

  let payload = { embeds: [] };
  const rawPayload = form.get("payload_json");
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      /* fall back to an empty embed list */
    }
  }

  const embed = Array.isArray(payload.embeds) ? payload.embeds[0] : undefined;
  if (embed && typeof embed === "object") {
    const fields = Array.isArray(embed.fields) ? [...embed.fields] : [];
    const label = aiSkippedByBudget
      ? "Not screened (daily AI budget reached)"
      : aiScreeningLabel(Boolean(env.AI), decision);
    fields.push({ name: "AI Screening", value: label, inline: false });
    embed.fields = fields;
  }

  const outForm = new FormData();
  outForm.append("payload_json", JSON.stringify(payload));
  outForm.append("files[0]", file, file.name);

  try {
    const response = await fetch(webhook, { method: "POST", body: outForm });
    if (!response.ok) return json({ message: "Discord rejected the submission." }, response.status);
    return json({ ok: true });
  } catch {
    return json({ message: "Discord unreachable." }, 502);
  }
}