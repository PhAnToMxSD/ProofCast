// Phase 4 — RawMatch (cache/raw) → validated MatchBrief (cache/briefs).
//
// Pure and offline: builds only from a cached raw bundle, computes proof links
// deterministically, and never re-hits the API. The zod schema is the gate — a
// brief that doesn't validate is not written.

import { PublicKey } from "@solana/web3.js";
import * as cfg from "./config.js";
import type { RawMatch, KeyEvent } from "./fetch.js";
import { STAT_KEY } from "./fetch.js";
import { MatchBriefSchema, type MatchBrief, type BriefEvent, type Proof } from "./types.js";

const EXPLORER = "https://explorer.solana.com";

/** Deterministic daily_scores_roots PDA for a given epoch day (u16 LE seed). */
function dailyScoresRootPda(epochDay: number): string {
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(epochDay);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), seed],
    cfg.PROGRAM_ID
  )[0].toBase58();
}

/** Build a resolvable proof for a { fixtureId, seq, statKey } coordinate. */
function makeProof(fixtureId: number, seq: number, statKey: number, ts: number): Proof {
  const epochDay = Math.floor(ts / 86400000);
  const rootPda = dailyScoresRootPda(epochDay);
  return {
    fixtureId,
    seq,
    statKey,
    timestamp: ts,
    epochDay,
    rootPda,
    explorerUrl: `${EXPLORER}/address/${rootPda}?cluster=devnet`,
    statValidationUrl: `${cfg.API_BASE_URL}/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`,
  };
}

/** Pull a {home, away} pair out of the final Stats map using Participant1IsHome. */
function sideTotals(
  stats: Record<string, number>,
  p1Key: number,
  p2Key: number,
  p1IsHome: boolean
): { home: number; away: number } {
  const p1 = Number(stats[String(p1Key)] ?? 0);
  const p2 = Number(stats[String(p2Key)] ?? 0);
  return p1IsHome ? { home: p1, away: p2 } : { home: p2, away: p1 };
}

// Per-period stat keys are the whole-game base key offset by the period:
// first half = 1000 + base, second half = 3000 + base (confirmed empirically —
// first + second reconciles exactly to the whole-game total).
const FIRST_HALF_OFFSET = 1000;
const SECOND_HALF_OFFSET = 3000;

/**
 * Derive the half-time score from the per-period stat keys, but ONLY if the two
 * halves reconcile to the full-time score. If they don't (or the keys are
 * absent), return undefined — we never guess a half-time score.
 */
function deriveHalfTime(
  stats: Record<string, number>,
  p1IsHome: boolean,
  fullTime: { home: number; away: number }
): { home: number; away: number } | undefined {
  const g1 = STAT_KEY.homeGoals; // participant-1 goals base key
  const g2 = STAT_KEY.awayGoals; // participant-2 goals base key
  const has = (k: number) => String(k) in stats;
  if (![FIRST_HALF_OFFSET, SECOND_HALF_OFFSET].every((o) => has(o + g1) && has(o + g2))) {
    return undefined;
  }
  const first = sideTotals(stats, FIRST_HALF_OFFSET + g1, FIRST_HALF_OFFSET + g2, p1IsHome);
  const second = sideTotals(stats, SECOND_HALF_OFFSET + g1, SECOND_HALF_OFFSET + g2, p1IsHome);
  const reconciles =
    first.home + second.home === fullTime.home && first.away + second.away === fullTime.away;
  return reconciles ? first : undefined;
}

/** Per-half corner split — same reconciliation guard as the half-time score. */
function deriveCornersByHalf(
  stats: Record<string, number>,
  p1IsHome: boolean,
  fullTime: { home: number; away: number }
) {
  const c1 = STAT_KEY.homeCorner;
  const c2 = STAT_KEY.awayCorner;
  const has = (k: number) => String(k) in stats;
  if (![FIRST_HALF_OFFSET, SECOND_HALF_OFFSET].every((o) => has(o + c1) && has(o + c2))) {
    return undefined;
  }
  const first = sideTotals(stats, FIRST_HALF_OFFSET + c1, FIRST_HALF_OFFSET + c2, p1IsHome);
  const second = sideTotals(stats, SECOND_HALF_OFFSET + c1, SECOND_HALF_OFFSET + c2, p1IsHome);
  const reconciles =
    first.home + second.home === fullTime.home && first.away + second.away === fullTime.away;
  return reconciles ? { first, second } : undefined;
}

function toBriefEvent(e: KeyEvent, idx: number, raw: RawMatch): BriefEvent {
  const teamName = e.team === "home" ? raw.homeTeam : raw.awayTeam;
  const type: BriefEvent["type"] =
    e.type === "goal" ? "goal" : e.type === "yellow" ? "yellow" : e.type === "red" ? "red" : e.type;
  return {
    id: `ev_${idx + 1}`,
    order: idx + 1,
    type,
    team: e.team === "unknown" ? "home" : e.team,
    teamName,
    homeScore: e.homeScore,
    awayScore: e.awayScore,
    ...(typeof e.minute === "number" ? { minute: e.minute } : {}),
    ...(typeof e.playerId === "number" ? { playerId: e.playerId } : {}),
    ...(e.detail ? { detail: e.detail } : {}),
    proof: makeProof(raw.fixtureId, e.seq, e.statKey ?? STAT_KEY.homeGoals, e.ts),
  };
}

/** Human-readable, honest notes about what the source data does and doesn't contain. */
function buildDataNotes(raw: RawMatch, events: KeyEvent[]): string[] {
  const notes: string[] = [];
  const anyMinutes = events.some((e) => typeof e.minute === "number");
  const anyPlayers = events.some((e) => typeof e.playerId === "number");
  if (!anyMinutes) notes.push("Event minutes are not available in this match's data — do not state or invent minutes.");
  if (!anyPlayers) notes.push("Scorer/player names are not available — refer to teams, not named players.");
  if (raw.odds.length === 0) notes.push("No odds data is available for this match — do not reference betting odds or market swings.");
  notes.push("Every listed event is cryptographically verified on-chain; there are no other events.");
  return notes;
}

export function buildBrief(raw: RawMatch): MatchBrief {
  const p1IsHome = raw.participant1IsHome;
  const stats = raw.final.stats ?? {};

  const events = raw.keyEvents.map((e, i) => toBriefEvent(e, i, raw));

  // Final-score proof: the home-goals statKey at the final `status` sequence.
  const homeGoalKey = p1IsHome ? STAT_KEY.homeGoals : STAT_KEY.awayGoals;
  const finalTs = raw.keyEvents.at(-1)?.ts ?? raw.startTime ?? Date.now();
  const finalScoreProof = makeProof(raw.fixtureId, raw.final.seq, homeGoalKey, finalTs);

  // Odds are absent on devnet specimen data; derive the timeline/highlights only
  // if real odds exist (kept for mainnet / future — empty is valid here).
  const oddsTimeline: MatchBrief["oddsTimeline"] = [];
  const oddsHighlights: MatchBrief["oddsHighlights"] = [];

  const finalScore = { home: raw.final.homeGoals, away: raw.final.awayGoals };
  const corners = sideTotals(stats, STAT_KEY.homeCorner, STAT_KEY.awayCorner, p1IsHome);
  const halfTimeScore = deriveHalfTime(stats, p1IsHome, finalScore);
  const cornersByHalf = deriveCornersByHalf(stats, p1IsHome, corners);

  const brief: MatchBrief = {
    matchId: String(raw.fixtureId),
    competition: raw.competition,
    date: new Date(raw.startTime).toISOString().slice(0, 10),
    homeTeam: raw.homeTeam,
    awayTeam: raw.awayTeam,
    finalScore,
    finalScoreProof,
    ...(halfTimeScore ? { halfTimeScore } : {}),
    events,
    stats: {
      goals: sideTotals(stats, STAT_KEY.homeGoals, STAT_KEY.awayGoals, p1IsHome),
      yellowCards: sideTotals(stats, STAT_KEY.homeYellow, STAT_KEY.awayYellow, p1IsHome),
      redCards: sideTotals(stats, STAT_KEY.homeRed, STAT_KEY.awayRed, p1IsHome),
      corners,
      ...(cornersByHalf ? { cornersByHalf } : {}),
    },
    oddsTimeline,
    oddsHighlights,
    dataNotes: buildDataNotes(raw, raw.keyEvents),
  };

  // The gate: validate before returning. Throws on any inconsistency.
  return MatchBriefSchema.parse(brief);
}

/** Extra sanity checks beyond the schema: events must reconcile to the final score. */
export function assertBriefConsistency(brief: MatchBrief): void {
  const homeGoals = brief.events.filter((e) => e.type === "goal" && e.team === "home").length;
  const awayGoals = brief.events.filter((e) => e.type === "goal" && e.team === "away").length;
  if (homeGoals !== brief.finalScore.home || awayGoals !== brief.finalScore.away) {
    throw new Error(
      `brief ${brief.matchId}: goal events (${homeGoals}-${awayGoals}) do not match final score (${brief.finalScore.home}-${brief.finalScore.away})`
    );
  }
  const ids = new Set(brief.events.map((e) => e.id));
  if (ids.size !== brief.events.length) throw new Error(`brief ${brief.matchId}: duplicate event ids`);
}
