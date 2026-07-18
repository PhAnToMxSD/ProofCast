// Phase 6 — narrate a grounded recap as audio via ElevenLabs. QUOTA-CRITICAL.
//
//   npx tsx scripts/05-generate-audio.ts --match <id> --style <hype|analyst|bedtime>
//   npx tsx scripts/05-generate-audio.ts --match <id> --custom "<persona>"
//
// The free tier is 10,000 characters/month for the WHOLE account. This script
// refuses to spend any of it unless you pass --confirm, prints the exact cost and
// the live remaining quota first, and never re-synthesizes an audio file that
// already exists (use --force to override). Reads cache/recaps/, writes
// cache/audio/<id>-<style>.mp3 (committed — demo fallback) and logs every spend
// to cache/tts-usage.json.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cfg from "../src/config.js";
import { isPresetKey, type StyleKey } from "../src/styles.js";
import type { Recap } from "../src/recap.js";
import { hasApiKey, getQuota, synthesize, charCost, voiceForStyle } from "../src/tts.js";

const RECAPS_DIR = path.join(cfg.CACHE_DIR, "recaps");
const AUDIO_DIR = path.join(cfg.CACHE_DIR, "audio");
const USAGE_LOG = path.join(cfg.CACHE_DIR, "tts-usage.json");

// Characters to hold back for the live demo recording (incl. one retake).
const DEFAULT_RESERVE = 2500;

const HELP = `
ProofCast — 05-generate-audio (Phase 6: TTS narration) ⚠️ QUOTA-CRITICAL

Usage:
  --match <id> --style <hype|analyst|bedtime>   Narrate one preset recap
  --match <id> --custom "<persona>"             Narrate a custom-persona recap

Options:
  --confirm        REQUIRED to actually spend quota. Without it, this is a dry run.
  --force          Re-synthesize even if the mp3 already exists.
  --voice <id>     Override the persona's default ElevenLabs voice id.
  --reserve <n>    Characters to keep in reserve for the live demo (default ${DEFAULT_RESERVE}).
  --quota          Just print the live remaining quota and exit.
  --help

Free tier = 10,000 chars/month for the whole account. Budget ~4-6 recaps total.
Reads cache/recaps/<id>-<style>.json.  Writes cache/audio/<id>-<style>.mp3.
Requires ELEVENLABS_API_KEY.
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

// Mirror scripts/04-generate-text.ts so recap and audio filenames line up.
function recapStem(id: number, style: StyleKey, customPersona?: string): string {
  if (style === "custom") {
    const h = crypto.createHash("sha1").update(customPersona ?? "").digest("hex").slice(0, 8);
    return `${id}-custom-${h}`;
  }
  return `${id}-${style}`;
}

type UsageEntry = {
  stem: string;
  chars: number;
  voiceId: string;
  remainingAfter: number;
  at: string;
};

function readUsageLog(): UsageEntry[] {
  if (!fs.existsSync(USAGE_LOG)) return [];
  try {
    return JSON.parse(fs.readFileSync(USAGE_LOG, "utf8"));
  } catch {
    return [];
  }
}

function appendUsage(entry: UsageEntry): void {
  const log = readUsageLog();
  log.push(entry);
  fs.mkdirSync(cfg.CACHE_DIR, { recursive: true });
  fs.writeFileSync(USAGE_LOG, JSON.stringify(log, null, 2));
}

// Characters we've already logged spending — feeds the local quota estimate
// used when the API key can't read the live subscription figure.
function loggedSpend(): number {
  return readUsageLog().reduce((sum, e) => sum + e.chars, 0);
}

async function main() {
  if (has("--help")) return void console.log(HELP);
  if (!hasApiKey()) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. Add it to .env (free key at elevenlabs.io), then re-run."
    );
  }

  // --quota: just report and exit (costs no quota).
  if (has("--quota")) {
    const q = await getQuota(loggedSpend());
    const src = q.estimated ? " (estimated from local log — key lacks user_read)" : "";
    console.log(`ElevenLabs quota: ${q.used}/${q.limit} used · ${q.remaining} chars remaining this period${src}.`);
    return;
  }

  const id = Number(arg("--match"));
  if (!Number.isFinite(id)) throw new Error("--match <id> is required");

  const customPersona = arg("--custom");
  let style: StyleKey;
  if (customPersona) {
    style = "custom";
  } else {
    const s = arg("--style");
    if (!s || !isPresetKey(s)) {
      throw new Error(`--style must be one of: hype, analyst, bedtime (or use --custom "<persona>")`);
    }
    style = s;
  }

  const stem = recapStem(id, style, customPersona);
  const recapPath = path.join(RECAPS_DIR, `${stem}.json`);
  const audioPath = path.join(AUDIO_DIR, `${stem}.mp3`);

  if (!fs.existsSync(recapPath)) {
    throw new Error(`no recap at ${recapPath} — run 04-generate-text first`);
  }

  // Skip if already narrated (unless --force). Never spend quota redundantly.
  if (fs.existsSync(audioPath) && !has("--force")) {
    const kb = (fs.statSync(audioPath).size / 1024).toFixed(0);
    console.log(`· ${stem}.mp3 already exists (${kb} KB) — skipping. Use --force to regenerate.`);
    return;
  }

  const recap: Recap = JSON.parse(fs.readFileSync(recapPath, "utf8"));
  const text = recap.text;
  const chars = charCost(text);
  const voice = voiceForStyle(style, arg("--voice"));
  const reserve = arg("--reserve") != null ? Number(arg("--reserve")) : DEFAULT_RESERVE;

  const q = await getQuota(loggedSpend());
  const remainingAfter = q.remaining - chars;
  const qSrc = q.estimated ? "  (estimated — key lacks user_read)" : "";

  console.log(`
Recap:      ${stem}  (${recap.styleLabel})
Voice:      ${voice.name} [${voice.voiceId}]  stability=${voice.stability}
Cost:       ${chars} characters
Quota:      ${q.used}/${q.limit} used · ${q.remaining} remaining${qSrc}
After this: ${remainingAfter} remaining  (reserve for demo: ${reserve})`);

  // Hard stop: not enough quota to complete this synthesis.
  if (chars > q.remaining) {
    throw new Error(
      `not enough quota: this recap needs ${chars} chars but only ${q.remaining} remain. Aborting (no call made).`
    );
  }

  // Soft stop: completing this would dip into the demo reserve.
  if (remainingAfter < reserve && !has("--force")) {
    throw new Error(
      `this would leave ${remainingAfter} chars, below the ${reserve}-char demo reserve. ` +
        `Re-run with --force to override, or lower --reserve.`
    );
  }

  // The gate. No --confirm ⇒ dry run, zero quota spent.
  if (!has("--confirm")) {
    console.log(`\nDRY RUN — pass --confirm to spend ${chars} characters and write ${stem}.mp3.`);
    return;
  }

  process.stdout.write(`\nSynthesizing ${chars} chars with ${voice.name}… `);
  const mp3 = await synthesize(text, voice);
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.writeFileSync(audioPath, mp3);
  const kb = (mp3.length / 1024).toFixed(0);
  console.log(`✓ wrote ${audioPath} (${kb} KB)`);

  appendUsage({
    stem,
    chars,
    voiceId: voice.voiceId,
    remainingAfter,
    at: new Date().toISOString(),
  });
  console.log(`Logged spend to cache/tts-usage.json · ~${remainingAfter} chars left this month.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`\n✗ ${err?.message ?? err}`);
    process.exit(1);
  }
);
