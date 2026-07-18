// Phase 5 — turn a MatchBrief into a grounded, cited, validated recap.
//
// Flow: slim the brief (strip proof noise the model doesn't need) → prompt a
// pinned model → parse [ev_N] / [final] citations → map them back to real proofs
// → VALIDATE (score matches, every cited id exists) → strip tags for display.
// Validation failures throw: an ungrounded recap is never written.

import type { MatchBrief, Proof } from "./types.js";
import { resolveStyle, systemPrompt, type Style, type StyleKey } from "./styles.js";
import { generate, CANDIDATE_MODELS, QuotaError, type ChatMessage } from "./llm.js";

// What the model actually sees — facts only, no proof URLs/PDAs.
function slimBrief(brief: MatchBrief) {
  return {
    competition: brief.competition,
    date: brief.date,
    homeTeam: brief.homeTeam,
    awayTeam: brief.awayTeam,
    finalScore: brief.finalScore,
    events: brief.events.map((e) => ({
      id: e.id,
      type: e.type,
      team: e.team === "home" ? brief.homeTeam : brief.awayTeam,
      scoreAfter: `${e.homeScore}-${e.awayScore}`,
      ...(e.minute != null ? { minute: e.minute } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
    })),
    stats: brief.stats,
    dataNotes: brief.dataNotes,
  };
}

export function buildMessages(brief: MatchBrief, style: Style, favouriteTeam?: string): ChatMessage[] {
  const brief_ = slimBrief(brief);
  const user = [
    `MATCH BRIEF (the only facts you may use):`,
    "```json",
    JSON.stringify(brief_, null, 2),
    "```",
    "",
    `Write the match recap in your persona voice. Cite every factual claim with its event id`,
    `(e.g. [ev_2]) and cite the final score with [final]. 300-400 words.`,
    `You MUST state the final score using the digits "${brief.finalScore.home}-${brief.finalScore.away}" somewhere in the recap`,
    `(you may also describe it in words, but the digits must appear), immediately followed by [final].`,
  ].join("\n");
  return [
    { role: "system", content: systemPrompt(style, favouriteTeam) },
    { role: "user", content: user },
  ];
}

export type Citation = {
  marker: string; // "ev_3" or "final"
  kind: "event" | "final";
  eventId?: string;
  proof: Proof;
};

export type Recap = {
  matchId: string;
  style: StyleKey;
  styleLabel: string;
  model: string;
  favouriteTeam?: string;
  customPersona?: string; // present only for style "custom" — the listener's raw text
  text: string; // display text — citation tags stripped
  citations: Citation[]; // ordered as they appeared
  wordCount: number;
  generatedAt: string;
};

// Matches a citation bracket that holds one OR a comma-separated list of markers:
// [ev_3]  ·  [final]  ·  [ev_4, ev_6]  ·  [ev_2, ev_3, ev_5]
const CITATION_RE = /\[\s*((?:ev_\d+|final)(?:\s*,\s*(?:ev_\d+|final))*)\s*\]/g;

/** Map cited markers back to proofs and enforce that every citation is real. */
function resolveCitations(rawText: string, brief: MatchBrief): Citation[] {
  const byId = new Map(brief.events.map((e) => [e.id, e]));
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const m of rawText.matchAll(CITATION_RE)) {
    for (const marker of m[1].split(",").map((s) => s.trim())) {
      if (seen.has(marker)) continue;
      seen.add(marker);
      if (marker === "final") {
        citations.push({ marker, kind: "final", proof: brief.finalScoreProof });
      } else {
        const ev = byId.get(marker);
        if (!ev) {
          throw new Error(`recap cites ${marker} which does not exist in brief ${brief.matchId}`);
        }
        citations.push({ marker, kind: "event", eventId: marker, proof: ev.proof });
      }
    }
  }
  return citations;
}

/** The final score must be stated correctly somewhere in the prose. */
function assertScoreStated(text: string, brief: MatchBrief): void {
  const { home, away } = brief.finalScore;
  const hay = text.toLowerCase();
  // Each side may be written as a digit, or "nil"/"zero" for 0.
  const forms = (n: number) => (n === 0 ? ["0", "nil", "zero"] : [String(n)]);
  const variants: string[] = [];
  for (const h of forms(home))
    for (const a of forms(away)) {
      variants.push(`${h}-${a}`, `${h}–${a}`, `${h} - ${a}`, `${h}:${a}`, `${h} to ${a}`);
    }
  if (home === away) variants.push(`${home} all`, `${home} apiece`, `${home}-all`);
  if (!variants.some((v) => hay.includes(v.toLowerCase()))) {
    throw new Error(
      `recap for ${brief.matchId} never states the correct final score ${home}-${away}`
    );
  }
}

function stripTags(text: string): string {
  return text.replace(CITATION_RE, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?;:])/g, "$1").trim();
}

// Reject chain-of-thought leakage and non-prose. Reasoning models echo the
// instructions ("We need to…", "Word count:", markdown fences) instead of
// writing the recap; those must trigger a rotation to a real writer.
const LEAK_MARKERS = [
  "we need to",
  "let's draft",
  "let us draft",
  "word count",
  "datanotes",
  "```",
  "structure:",
  "the brief",
  "match brief",
  "square bracket",
  "cite each",
  "as an ai",
];

function assertLooksLikeProse(rawText: string): void {
  const hay = rawText.toLowerCase();
  const hit = LEAK_MARKERS.find((m) => hay.includes(m));
  if (hit) throw new Error(`output looks like leaked reasoning (matched "${hit}") — not a recap`);
  const words = stripTags(rawText).split(/\s+/).filter(Boolean).length;
  if (words > 480) throw new Error(`output is ${words} words (target 300-400) — likely rambling/reasoning`);
  if (words < 120) throw new Error(`output is only ${words} words — too short to be a real recap`);
}

/**
 * Validate raw model output against the brief and assemble the final Recap.
 * Pure and synchronous (no network) so it can be unit-tested. Throws on any
 * grounding violation — fabricated citation id, missing/wrong final score, or
 * no citations at all.
 */
export function finalizeRecap(
  rawText: string,
  brief: MatchBrief,
  style: Style,
  model: string,
  opts: { favouriteTeam?: string; customPersona?: string } = {}
): Recap {
  assertLooksLikeProse(rawText); // throws on chain-of-thought leakage / bad length
  const citations = resolveCitations(rawText, brief); // throws on a fabricated id
  assertScoreStated(rawText, brief); // throws if the scoreline is wrong/missing
  if (citations.length === 0) throw new Error(`recap for ${brief.matchId} contains no citations`);

  const text = stripTags(rawText);
  return {
    matchId: brief.matchId,
    style: style.key,
    styleLabel: style.label,
    model,
    ...(opts.favouriteTeam ? { favouriteTeam: opts.favouriteTeam } : {}),
    ...(opts.customPersona ? { customPersona: opts.customPersona } : {}),
    text,
    citations,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateRecap(
  brief: MatchBrief,
  styleKey: StyleKey,
  opts: { favouriteTeam?: string; customPersona?: string; model?: string; temperature?: number } = {}
): Promise<Recap> {
  const style = resolveStyle(styleKey, opts.customPersona); // throws on unknown/missing
  const messages = buildMessages(brief, style, opts.favouriteTeam);

  // Rotate across candidate models on ANY failure — unavailability (429) or a
  // recap that fails grounding/prose validation. This keeps demo output honest
  // AND reliable on a flaky free tier. --model pins a single model (no rotation).
  const chain = opts.model ? [opts.model] : CANDIDATE_MODELS;
  let lastErr: Error | undefined;
  for (const model of chain) {
    try {
      const { text: rawText } = await generate(messages, {
        model,
        temperature: opts.temperature,
      });
      return finalizeRecap(rawText, brief, style, model, {
        favouriteTeam: opts.favouriteTeam,
        customPersona: opts.customPersona,
      });
    } catch (err) {
      lastErr = err as Error;
      if (chain.length > 1) console.warn(`  · ${model}: ${lastErr.message} — rotating…`);
    }
  }
  if (lastErr instanceof QuotaError) throw lastErr;
  throw new Error(`all candidate models failed for ${brief.matchId}/${styleKey}: ${lastErr?.message}`);
}
