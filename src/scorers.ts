// Web2 scorer enrichment — the ONE thing TxLINE's devnet feed doesn't carry.
//
// TxLINE proves *that* a goal happened, for *which* team, at *what* minute
// (on-chain Merkle proof). It does NOT carry the scorer's name. We supply names
// from a public match report (FIFA/ESPN/etc.), authored once into a committed
// cache/scorers/<matchId>.json, and align them to the verified goal events by
// (team, goal order): the k-th verified goal for a team is the k-th scorer we
// listed for that team. The minute is a cross-check, never the alignment key —
// so a name source that's a minute off can't misattribute a goal.
//
// Trust boundary: the goal/team/minute stay on-chain-verified; the NAME is
// web2-attributed and carries its `source` provenance. Nothing is invented.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as cfg from "./config.js";
import type { BriefEvent } from "./types.js";

export const SCORERS_DIR = path.join(cfg.CACHE_DIR, "scorers");

// One scored goal as reported by the web2 source, in chronological order.
// `team` is the side the goal COUNTS FOR (for an own goal, the beneficiary),
// matching how TxLINE attributes it. `scorer` is the player credited.
const ScoredGoalSchema = z.object({
  team: z.enum(["home", "away"]),
  scorer: z.string().min(1),
  officialMinute: z.string().optional(), // as printed, e.g. "7'", "90+4'" — cross-check only
  penalty: z.boolean().optional(),
  ownGoal: z.boolean().optional(),
});
export type ScoredGoal = z.infer<typeof ScoredGoalSchema>;

// One booking as reported by the web2 source, in chronological order. `team` is
// the side the booked player belongs to; `card` distinguishes yellow from red so
// a name can never be aligned to the wrong card type.
const BookingSchema = z.object({
  team: z.enum(["home", "away"]),
  player: z.string().min(1),
  card: z.enum(["yellow", "red"]),
  officialMinute: z.string().optional(), // as printed — cross-check only
});
export type Booking = z.infer<typeof BookingSchema>;

export const ScorersFileSchema = z.object({
  matchId: z.string(),
  source: z.object({
    name: z.string().min(1), // e.g. "FIFA / ESPN" — shown in the UI as the name provenance
    url: z.string().url().optional(),
    fetchedAt: z.string().optional(),
  }),
  goals: z.array(ScoredGoalSchema), // chronological
  cards: z.array(BookingSchema).optional(), // chronological; omit when unknown
  note: z.string().optional(),
});
export type ScorersFile = z.infer<typeof ScorersFileSchema>;

/** Load a committed scorers file for a match, or undefined if none exists. */
export function loadScorers(matchId: string): ScorersFile | undefined {
  const p = path.join(SCORERS_DIR, `${matchId}.json`);
  if (!fs.existsSync(p)) return undefined;
  return ScorersFileSchema.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

/** "7'" → 7 · "90+4'" → 94 · "45+2" → 47. Undefined if unparseable. */
export function parseOfficialMinute(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!m) return undefined;
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
}

export type ComposeResult = { events: BriefEvent[]; warnings: string[] };

/**
 * Attach scorer names to goal events by aligning per team in goal order.
 * Pure: returns new event objects (goals enriched, everything else untouched).
 * Throws if the source's goal count for a team doesn't match the verified count —
 * that disagreement is a real integrity signal, not something to paper over.
 */
export function composeScorers(events: BriefEvent[], scorers: ScorersFile): ComposeResult {
  const warnings: string[] = [];
  const MINUTE_TOLERANCE = 2;

  // Per-team FIFO queues of reported goals, in the order the source listed them.
  const queues: Record<"home" | "away", ScoredGoal[]> = { home: [], away: [] };
  for (const g of scorers.goals) queues[g.team].push(g);

  // Verified goal counts per team, from the chain-backed events.
  const verified = { home: 0, away: 0 };
  for (const e of events) if (e.type === "goal") verified[e.team]++;

  for (const team of ["home", "away"] as const) {
    if (queues[team].length !== verified[team]) {
      throw new Error(
        `scorers file for ${scorers.matchId}: source lists ${queues[team].length} ${team} goal(s) ` +
          `but TxLINE verifies ${verified[team]} — refusing to guess the mapping.`
      );
    }
  }

  const out = events.map((e) => {
    if (e.type !== "goal") return e;
    const g = queues[e.team].shift();
    if (!g) return e; // count-checked above, so this is unreachable — belt and braces
    const official = parseOfficialMinute(g.officialMinute);
    if (official != null && e.minute != null && Math.abs(official - e.minute) > MINUTE_TOLERANCE) {
      warnings.push(
        `${e.id}: source minute ${g.officialMinute} vs TxLINE ${e.minute}' ` +
          `(>${MINUTE_TOLERANCE} apart) — kept the verified minute, flagging the name as lower-confidence.`
      );
    }
    const details = [e.detail, g.penalty ? "Penalty" : undefined, g.ownGoal ? "Own goal" : undefined]
      .filter(Boolean)
      .join(" · ");
    return {
      ...e,
      scorer: g.scorer,
      nameSource: scorers.source.name,
      ...(details ? { detail: details } : {}),
    };
  });

  return { events: out, warnings };
}

/**
 * Attach booked-player names to card events, mirroring composeScorers but keyed
 * by (team, card type): the k-th verified yellow for a team maps to the k-th
 * listed yellow for that team, and likewise for reds — so a yellow name can never
 * land on a red event. Returns events unchanged if the file carries no `cards`.
 * Throws if the source's per-(team, card) count disagrees with the verified count.
 */
export function composeCards(events: BriefEvent[], scorers: ScorersFile): ComposeResult {
  const warnings: string[] = [];
  const MINUTE_TOLERANCE = 2;
  const bookings = scorers.cards;
  if (!bookings || bookings.length === 0) return { events, warnings };

  // FIFO queues keyed by "<team>:<card>", in the order the source listed them.
  const queues: Record<string, Booking[]> = {};
  const key = (team: "home" | "away", card: "yellow" | "red") => `${team}:${card}`;
  for (const b of bookings) (queues[key(b.team, b.card)] ??= []).push(b);

  // Verified card counts per (team, type), from the chain-backed events.
  const verified: Record<string, number> = {};
  for (const e of events) {
    if (e.type === "yellow" || e.type === "red") {
      const k = key(e.team, e.type);
      verified[k] = (verified[k] ?? 0) + 1;
    }
  }

  // Each (team, card type) bucket must be EITHER fully accounted for (listed ==
  // verified) OR omitted entirely (listed == 0). We never map a partially-listed
  // bucket — with, say, two yellows for a side and only one name, order-alignment
  // could credit the wrong player. Omitted buckets simply stay team-only. This is
  // what lets us name the red cards while leaving the yellows unattributed.
  const allKeys = new Set([...Object.keys(queues), ...Object.keys(verified)]);
  for (const k of allKeys) {
    const listed = queues[k]?.length ?? 0;
    const seen = verified[k] ?? 0;
    if (listed !== 0 && listed !== seen) {
      const [team, card] = k.split(":");
      throw new Error(
        `scorers file for ${scorers.matchId}: source lists ${listed} ${team} ${card} card(s) ` +
          `but TxLINE verifies ${seen} — a bucket must be fully listed or omitted, not partial.`
      );
    }
  }

  const out = events.map((e) => {
    if (e.type !== "yellow" && e.type !== "red") return e;
    const b = queues[key(e.team, e.type)]?.shift();
    if (!b) return e; // count-checked above, so unreachable — belt and braces
    const official = parseOfficialMinute(b.officialMinute);
    if (official != null && e.minute != null && Math.abs(official - e.minute) > MINUTE_TOLERANCE) {
      warnings.push(
        `${e.id}: source minute ${b.officialMinute} vs TxLINE ${e.minute}' ` +
          `(>${MINUTE_TOLERANCE} apart) — kept the verified minute, flagging the name as lower-confidence.`
      );
    }
    return { ...e, player: b.player, nameSource: scorers.source.name };
  });

  return { events: out, warnings };
}
