// Phase 5 — generate grounded commentary text (NO audio; that's Phase 6).
//
//   npx tsx scripts/04-generate-text.ts --match <id> --style <hype|analyst|bedtime>
//   npx tsx scripts/04-generate-text.ts --match <id> --all-styles
//   npx tsx scripts/04-generate-text.ts --all                 # every cached match × every style
//   npx tsx scripts/04-generate-text.ts --audition --match <id>   # try candidate models on one brief
//
// Options: --team <name> (personalization), --model <id> (override pin),
//          --force (regenerate), --help.
//
// Writes cache/recaps/<matchId>-<style>.json. Reads cache/briefs/<id>.json.

import fs from "node:fs";
import path from "node:path";
import * as cfg from "../src/config.js";
import { MatchBriefSchema, type MatchBrief } from "../src/types.js";
import { STYLE_KEYS, type StyleKey } from "../src/styles.js";
import { generateRecap } from "../src/recap.js";
import { hasApiKey, QuotaError, PRIMARY_MODEL, FALLBACK_MODEL } from "../src/llm.js";

const BRIEFS_DIR = path.join(cfg.CACHE_DIR, "briefs");
const RECAPS_DIR = path.join(cfg.CACHE_DIR, "recaps");

const HELP = `
ProofCast — 04-generate-text (Phase 5: grounded commentary, no TTS)

Usage:
  --match <id> --style <hype|analyst|bedtime>   Generate one recap
  --match <id> --all-styles                     All styles for one match
  --all                                         Every cached match × every style
  --audition --match <id>                       Try candidate models on one brief (picks nothing)

Options:
  --team <name>   Personalize toward a supported team.
  --model <id>    Override the pinned model.
  --force         Regenerate even if the recap file exists.
  --help

Pinned models:  PRIMARY ${PRIMARY_MODEL}   FALLBACK ${FALLBACK_MODEL}
Writes cache/recaps/<id>-<style>.json.  Requires OPENROUTER_API_KEY.
`;

const AUDITION_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function loadBrief(id: number): MatchBrief {
  const p = path.join(BRIEFS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`no brief at ${p} — run 03-build-brief first`);
  return MatchBriefSchema.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

function recapPath(id: number, style: StyleKey) {
  return path.join(RECAPS_DIR, `${id}-${style}.json`);
}

async function genOne(id: number, style: StyleKey, force: boolean, team?: string, model?: string): Promise<boolean> {
  const dest = recapPath(id, style);
  if (fs.existsSync(dest) && !force) {
    console.log(`· ${id}-${style}: exists (use --force) — skipping`);
    return true;
  }
  const brief = loadBrief(id);
  process.stdout.write(`· ${id}-${style}: generating… `);
  try {
    const recap = await generateRecap(brief, style, { favouriteTeam: team, model });
    fs.mkdirSync(RECAPS_DIR, { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(recap, null, 2));
    console.log(`✓ ${recap.wordCount} words, ${recap.citations.length} citations, model ${recap.model}`);
    return true;
  } catch (err: any) {
    // In a batch, one failure (e.g. every free model saturated) must not abort
    // the rest. Report and continue; the recap can be regenerated later.
    console.log(`✗ ${err?.message ?? err}`);
    return false;
  }
}

async function audition(id: number, team?: string) {
  const brief = loadBrief(id);
  console.log(`Auditioning ${AUDITION_MODELS.length} models on ${brief.homeTeam} ${brief.finalScore.home}-${brief.finalScore.away} ${brief.awayTeam} (style: analyst)\n`);
  for (const model of AUDITION_MODELS) {
    try {
      const recap = await generateRecap(brief, "analyst", { favouriteTeam: team, model });
      console.log(`\n───────── ${model} (${recap.wordCount} words, ${recap.citations.length} citations) ─────────`);
      console.log(recap.text);
    } catch (e: any) {
      console.log(`\n───────── ${model} — FAILED: ${e.message} ─────────`);
    }
  }
  console.log(`\nPick the best writer, then set PRIMARY_MODEL in src/llm.ts.`);
}

async function main() {
  if (has("--help")) return void console.log(HELP);
  if (!hasApiKey()) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env (get a free key at openrouter.ai — email/GitHub signup, no card), then re-run."
    );
  }

  const team = arg("--team");
  const model = arg("--model");
  const force = has("--force");

  if (has("--audition")) {
    const id = Number(arg("--match"));
    if (!Number.isFinite(id)) throw new Error("--audition requires --match <id>");
    await audition(id, team);
    return;
  }

  const allMatches = fs.existsSync(BRIEFS_DIR)
    ? fs.readdirSync(BRIEFS_DIR).filter((f) => f.endsWith(".json")).map((f) => Number(f.replace(".json", "")))
    : [];

  if (has("--all")) {
    if (allMatches.length === 0) throw new Error("no briefs in cache/briefs/");
    for (const id of allMatches) for (const s of STYLE_KEYS) await genOne(id, s, force, team, model);
  } else {
    const id = Number(arg("--match"));
    if (!Number.isFinite(id)) throw new Error("--match <id> is required");
    if (has("--all-styles")) {
      for (const s of STYLE_KEYS) await genOne(id, s, force, team, model);
    } else {
      const style = arg("--style") as StyleKey;
      if (!STYLE_KEYS.includes(style)) throw new Error(`--style must be one of: ${STYLE_KEYS.join(", ")}`);
      await genOne(id, style, force, team, model);
    }
  }

  const n = fs.existsSync(RECAPS_DIR) ? fs.readdirSync(RECAPS_DIR).filter((f) => f.endsWith(".json")).length : 0;
  console.log(`\n✓ cache/recaps/ now holds ${n} recap(s).`);
}

main().then(
  () => process.exit(0),
  (err) => {
    if (err instanceof QuotaError) console.error(`\n✗ ${err.message}\n  Wait a moment and retry — do not hammer the endpoint.`);
    else console.error(`\n✗ ${err?.message ?? err}`);
    process.exit(1);
  }
);
