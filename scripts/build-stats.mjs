// Phase 8 — build a per-match "team stats" panel from the on-chain TxLINE feed.
//
// TxLINE proves goals, corners and cards as named aggregates (Score.Total, one
// Merkle-proven stat slot each) and streams every shot and possession phase as
// its own on-chain event. This composes those into the stats fans expect from a
// Google-style panel — but every figure traces back to TxLINE:
//   • aggregate (corners / yellow / red): value + per-stat Merkle proof
//   • derived  (shots / on-target / possession): counted from N on-chain events
//
// Reads cache/raw/<id>.json (+ cache/briefs for the day's proof anchor), writes
// cache/stats/<id>.json. Run: node scripts/build-stats.mjs
//
// Stat-slot → statKey mapping (verified against known scorelines):
//   1/2 = P1/P2 goals · 3/4 = yellow · 5/6 = red · 7/8 = corners

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(repo, "cache/raw");
const BRIEFS = path.join(repo, "cache/briefs");
const OUT = path.join(repo, "cache/stats");
fs.mkdirSync(OUT, { recursive: true });

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const lastWhere = (arr, pred) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i]; };

// Build a proof object for one aggregate stat by reusing the day's Merkle root
// (same match/day ⇒ same rootPda) at the final stat record's seq + this statKey.
function statProof(brief, finalSeq, finalTs, statKey) {
  const base = brief.finalScoreProof;
  return {
    fixtureId: base.fixtureId,
    seq: finalSeq,
    statKey,
    timestamp: finalTs,
    epochDay: base.epochDay,
    rootPda: base.rootPda,
    explorerUrl: base.explorerUrl,
    statValidationUrl:
      `https://txline-dev.txodds.com/api/scores/stat-validation` +
      `?fixtureId=${base.fixtureId}&seq=${finalSeq}&statKey=${statKey}`,
  };
}

function buildStats(id) {
  const raw = read(path.join(RAW, `${id}.json`));
  const brief = read(path.join(BRIEFS, `${id}.json`));
  const tl = raw.timeline || [];
  const p1Home = raw.participant1IsHome ?? tl.find((r) => r.Participant1IsHome != null)?.Participant1IsHome ?? true;

  // Which participant index is home/away.
  const homeIdx = p1Home ? 1 : 2;
  const awayIdx = p1Home ? 2 : 1;

  // ── aggregate tallies: last record carrying a full Score.Total ──
  const scoreRec = lastWhere(tl, (r) => r.Score && (r.Score.Participant1?.Total || r.Score.Participant2?.Total));
  const total = (idx) => scoreRec?.Score?.[`Participant${idx}`]?.Total ?? {};
  const Th = total(homeIdx), Ta = total(awayIdx);

  // ── the proof-anchor record: last record with the full 8-slot Stats vector ──
  const statRec = lastWhere(tl, (r) => r.Stats && r.Stats["1"] != null) ?? scoreRec;
  const finalSeq = statRec?.Seq ?? brief.finalScoreProof.seq;
  const finalTs = statRec?.Ts ?? brief.finalScoreProof.timestamp;

  // statKey per (stat, side): odd = P1, even = P2.
  const keyFor = (slotP1, slotP2) => ({ home: p1Home ? slotP1 : slotP2, away: p1Home ? slotP2 : slotP1 });
  const kCorner = keyFor(7, 8), kYellow = keyFor(3, 4), kRed = keyFor(5, 6);

  // ── derived: shots + shots on target (dedup by Seq) ──
  const shotBySeq = new Map();
  for (const r of tl) if (r.Action === "shot" && r.Seq != null) shotBySeq.set(r.Seq, r);
  let shotH = 0, shotA = 0, otH = 0, otA = 0;
  for (const r of shotBySeq.values()) {
    const on = r.Data?.Outcome === "OnTarget";
    if (r.Participant === homeIdx) { shotH++; if (on) otH++; }
    else if (r.Participant === awayIdx) { shotA++; if (on) otA++; }
  }
  const shotEvents = shotBySeq.size;

  // ── derived: possession share (count of on-chain possession-tagged records) ──
  let posH = 0, posA = 0;
  for (const r of tl) {
    if (r.Possession === homeIdx) posH++;
    else if (r.Possession === awayIdx) posA++;
  }
  const posTot = posH + posA || 1;
  const possH = Math.round((posH / posTot) * 100);
  const possEvents = posH + posA;

  const stats = [
    { key: "shots", label: "Shots", home: shotH, away: shotA, kind: "derived", events: shotEvents },
    { key: "shotsOnTarget", label: "Shots on target", home: otH, away: otA, kind: "derived", events: shotEvents },
    { key: "possession", label: "Possession", home: possH, away: 100 - possH, unit: "%", kind: "derived", events: possEvents },
    {
      key: "corners", label: "Corners", home: Th.Corners ?? 0, away: Ta.Corners ?? 0, kind: "verified",
      proofHome: statProof(brief, finalSeq, finalTs, kCorner.home),
      proofAway: statProof(brief, finalSeq, finalTs, kCorner.away),
    },
    {
      key: "yellow", label: "Yellow cards", home: Th.YellowCards ?? 0, away: Ta.YellowCards ?? 0, kind: "verified",
      proofHome: statProof(brief, finalSeq, finalTs, kYellow.home),
      proofAway: statProof(brief, finalSeq, finalTs, kYellow.away),
    },
    {
      key: "red", label: "Red cards", home: Th.RedCards ?? 0, away: Ta.RedCards ?? 0, kind: "verified",
      proofHome: statProof(brief, finalSeq, finalTs, kRed.home),
      proofAway: statProof(brief, finalSeq, finalTs, kRed.away),
    },
  ];

  return {
    matchId: String(id),
    homeTeam: brief.homeTeam,
    awayTeam: brief.awayTeam,
    finalScore: brief.finalScore,
    stats,
    source: "TxLINE on-chain match feed (competition 72, Solana devnet)",
    generatedAt: new Date().toISOString(),
  };
}

const ids = fs.readdirSync(RAW).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
let n = 0;
for (const id of ids) {
  if (!fs.existsSync(path.join(BRIEFS, `${id}.json`))) continue;
  const out = buildStats(id);
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out, null, 2) + "\n");
  n++;
}
console.log(`wrote ${n} stats files`);
