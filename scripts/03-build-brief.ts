// Phase 4 — build validated MatchBriefs from cached raw matches.
//
//   npx tsx scripts/03-build-brief.ts --match <fixtureId>
//   npx tsx scripts/03-build-brief.ts --all
//
// Offline: reads cache/raw/<id>.json, writes cache/briefs/<id>.json (committed —
// the demo fallback). No API calls.

import fs from "node:fs";
import path from "node:path";
import * as cfg from "../src/config.js";
import type { RawMatch } from "../src/fetch.js";
import { buildBrief, assertBriefConsistency } from "../src/brief.js";
import type { MatchBrief } from "../src/types.js";

const BRIEFS_DIR = path.join(cfg.CACHE_DIR, "briefs");

const HELP = `
ProofCast — 03-build-brief (Phase 4: structured brief, anti-hallucination layer)

Usage:
  npx tsx scripts/03-build-brief.ts --match <fixtureId>   Build one brief
  npx tsx scripts/03-build-brief.ts --all                 Build briefs for every cached raw match

Options:
  --help    Show this help.

Reads cache/raw/<id>.json → validates with zod → writes cache/briefs/<id>.json.
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function loadRaw(fixtureId: number): RawMatch {
  const p = path.join(cfg.RAW_DIR, `${fixtureId}.json`);
  if (!fs.existsSync(p)) throw new Error(`no cached raw match at ${p} — run 02-fetch-match first`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as RawMatch;
}

function briefSummary(b: MatchBrief): string {
  const lines = [
    `  ${b.homeTeam} ${b.finalScore.home}-${b.finalScore.away} ${b.awayTeam}  (${b.competition}, ${b.date})`,
    `  ${b.events.length} verified events · cards Y ${b.stats.yellowCards.home}-${b.stats.yellowCards.away} R ${b.stats.redCards.home}-${b.stats.redCards.away} · corners ${b.stats.corners.home}-${b.stats.corners.away}`,
  ];
  for (const e of b.events) {
    const who = e.type === "goal" ? "⚽" : e.type === "yellow" ? "🟨" : e.type === "red" ? "🟥" : "•";
    const min = e.minute != null ? `${e.minute}'` : "  ";
    lines.push(`    [${e.id}] ${min} ${who} ${e.type.padEnd(4)} ${e.teamName.padEnd(12)} → ${e.homeScore}-${e.awayScore}  proof seq ${e.proof.seq}/key ${e.proof.statKey}`);
  }
  return lines.join("\n");
}

function buildOne(fixtureId: number, verbose = true): MatchBrief {
  const raw = loadRaw(fixtureId);
  const brief = buildBrief(raw); // zod-validates internally
  assertBriefConsistency(brief);
  fs.mkdirSync(BRIEFS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BRIEFS_DIR, `${fixtureId}.json`), JSON.stringify(brief, null, 2));
  if (verbose) {
    console.log(`✓ ${fixtureId} — validated & written to cache/briefs/${fixtureId}.json`);
    console.log(briefSummary(brief));
  }
  return brief;
}

async function main() {
  if (has("--help")) return void console.log(HELP);

  if (has("--all")) {
    const ids = fs.existsSync(cfg.RAW_DIR)
      ? fs.readdirSync(cfg.RAW_DIR).filter((f) => f.endsWith(".json")).map((f) => Number(f.replace(".json", "")))
      : [];
    if (ids.length === 0) throw new Error("no cached raw matches in cache/raw/");
    console.log(`Building briefs for ${ids.length} cached match(es)…\n`);
    for (const id of ids) {
      buildOne(id);
      console.log("");
    }
    console.log(`✓ ${ids.length} brief(s) in cache/briefs/`);
    return;
  }

  if (has("--match")) {
    const id = Number(arg("--match"));
    if (!Number.isFinite(id)) throw new Error("--match requires a numeric fixtureId");
    buildOne(id);
    return;
  }

  console.log(HELP);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`\n✗ ${err?.message ?? err}`);
    process.exit(1);
  }
);
