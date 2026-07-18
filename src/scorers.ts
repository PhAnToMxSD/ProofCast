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

export const ScorersFileSchema = z.object({
  matchId: z.string(),
  source: z.object({
    name: z.string().min(1), // e.g. "FIFA / ESPN" — shown in the UI as the name provenance
    url: z.string().url().optional(),
    fetchedAt: z.string().optional(),
  }),
  goals: z.array(ScoredGoalSchema), // chronological
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
