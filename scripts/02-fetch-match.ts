// Phase 3 — fetch completed matches into cache/raw/.
//
//   npx tsx scripts/02-fetch-match.ts --list [--limit N]
//   npx tsx scripts/02-fetch-match.ts --match <fixtureId> [--force]
//   npx tsx scripts/02-fetch-match.ts [--count N] [--force]   # auto-pick N completed
//
// Cached raw JSON is never re-fetched unless --force. Requires Phase 2 auth cache.

import fs from "node:fs";
import path from "node:path";
import * as cfg from "../src/config.js";
import { loadAuthCache, makeApiClient } from "../src/txline.js";
import { listCompleted, fetchMatch, type RawMatch } from "../src/fetch.js";

const HELP = `
ProofCast — 02-fetch-match (Phase 3: fetch completed matches, devnet)

Usage:
  npx tsx scripts/02-fetch-match.ts --list [--limit N]     List completed matches
  npx tsx scripts/02-fetch-match.ts --match <fixtureId>    Fetch + cache one match
  npx tsx scripts/02-fetch-match.ts [--count N]            Auto-pick & cache N completed (default 5)

Options:
  --force     Re-fetch even if cache/raw/<id>.json exists.
  --help      Show this help.

Each cached bundle contains the final score, a reconstructed event timeline, and
per-event proof coordinates (fixtureId + seq + statKey) for on-chain validation.
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function rawPath(fixtureId: number) {
  return path.join(cfg.RAW_DIR, `${fixtureId}.json`);
}

function summarize(m: RawMatch): string {
  const goals = m.keyEvents.filter((e) => e.type === "goal").length;
  const cards = m.keyEvents.filter((e) => e.type === "yellow" || e.type === "red").length;
  return `${m.homeTeam} ${m.final.homeGoals}-${m.final.awayGoals} ${m.awayTeam} · ${m.keyEvents.length} key events (${goals} goals, ${cards} cards) · final seq ${m.final.seq}`;
}

async function cacheOne(api: any, fixtureId: number, force: boolean): Promise<void> {
  const dest = rawPath(fixtureId);
  if (fs.existsSync(dest) && !force) {
    console.log(`· ${fixtureId}: cached already (use --force to refetch) — skipping`);
    return;
  }
  process.stdout.write(`· ${fixtureId}: fetching… `);
  const match = await fetchMatch(api, fixtureId);
  fs.mkdirSync(cfg.RAW_DIR, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(match, null, 2));
  console.log(`✓ ${summarize(match)}`);
}

async function main() {
  if (has("--help")) return void console.log(HELP);

  const state = loadAuthCache();
  if (!state) {
    throw new Error("No auth cache. Run Phase 2 first: npx tsx scripts/01-auth.ts");
  }
  const api = makeApiClient(state);
  const force = has("--force");

  if (has("--list")) {
    const limit = Number(arg("--limit") ?? 15);
    console.log(`Scanning for completed matches (limit ${limit})…\n`);
    const rows = await listCompleted(api, { limit });
    for (const r of rows) {
      console.log(`  ${r.fixtureId}  ${r.home} ${r.homeGoals}-${r.awayGoals} ${r.away}`);
    }
    console.log(`\n${rows.length} completed match(es). Fetch one with --match <id>.`);
    return;
  }

  if (has("--match")) {
    const id = Number(arg("--match"));
    if (!Number.isFinite(id)) throw new Error("--match requires a numeric fixtureId");
    await cacheOne(api, id, force);
  } else {
    const count = Number(arg("--count") ?? 5);
    console.log(`Auto-selecting ${count} completed match(es)…\n`);
    const rows = await listCompleted(api, { limit: count });
    if (rows.length === 0) throw new Error("no completed matches found");
    for (const r of rows) await cacheOne(api, r.fixtureId, force);
  }

  const cached = fs.existsSync(cfg.RAW_DIR)
    ? fs.readdirSync(cfg.RAW_DIR).filter((f) => f.endsWith(".json"))
    : [];
  console.log(`\n✓ cache/raw/ now holds ${cached.length} match(es): ${cached.join(", ")}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`\n✗ ${err?.message ?? err}`);
    process.exit(1);
  }
);
