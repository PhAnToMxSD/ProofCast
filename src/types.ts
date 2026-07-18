// Phase 4 — the MatchBrief: a tight, verified, zod-validated view of one match.
//
// This is the anti-hallucination contract. The LLM (Phase 5) is only ever shown
// data derived from here; anything not present in a MatchBrief must never appear
// in a recap. Every factual event carries a `proof` the website can turn into an
// on-chain "verify this moment" link.

import { z } from "zod";

// A resolvable proof coordinate for a single verified fact.
// There is no per-event txSig in TxLINE — verification is the Merkle scheme:
// { fixtureId, seq, statKey } → /scores/stat-validation → validate against the
// daily_scores_roots PDA published on-chain.
export const ProofSchema = z.object({
  fixtureId: z.number().int(),
  seq: z.number().int().positive(), // the score-update sequence this fact landed on
  statKey: z.number().int(), // which provable statistic (1/2 goals, 3/4 yellow, …)
  timestamp: z.number().int(), // ms, on-chain-anchored
  epochDay: z.number().int(), // days since epoch → PDA seed
  rootPda: z.string(), // daily_scores_roots PDA holding the published Merkle root
  explorerUrl: z.string().url(), // Solana Explorer link to that on-chain account (devnet)
  statValidationUrl: z.string().url(), // API endpoint returning the full Merkle proof
});
export type Proof = z.infer<typeof ProofSchema>;

export const EventTypeSchema = z.enum([
  "goal",
  "penalty",
  "yellow",
  "red",
  "substitution",
  "var",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const BriefEventSchema = z.object({
  id: z.string(), // stable citation id the LLM cites, e.g. "ev_1"
  order: z.number().int(), // chronological order within the match
  type: EventTypeSchema,
  team: z.enum(["home", "away"]),
  teamName: z.string(),
  homeScore: z.number().int(), // running score AFTER this event
  awayScore: z.number().int(),
  minute: z.number().int().optional(), // TxLINE match clock → floor(sec/60)+1; on-chain-anchored
  playerId: z.number().int().optional(), // numeric id only; no name feed on devnet
  // Scorer/actor name. NOT from the chain — resolved from a web2 match report and
  // aligned to this verified event by (team, goal order). `nameSource` records the
  // provenance so the UI can show "name via <source>" distinctly from the on-chain
  // proof of the event itself. Present only when a scorers file supplied it.
  scorer: z.string().optional(),
  nameSource: z.string().optional(),
  detail: z.string().optional(), // e.g. GoalType "Head"
  proof: ProofSchema,
});
export type BriefEvent = z.infer<typeof BriefEventSchema>;

const SideTotalsSchema = z.object({ home: z.number(), away: z.number() });

export const MatchBriefSchema = z.object({
  matchId: z.string(),
  competition: z.string(),
  date: z.string(), // ISO date (YYYY-MM-DD)
  homeTeam: z.string(),
  awayTeam: z.string(),
  finalScore: SideTotalsSchema.extend({ home: z.number().int(), away: z.number().int() }),
  finalScoreProof: ProofSchema, // proves the home-goals stat at the final status seq
  // Half-time score — only present when the feed's per-period stat keys reconcile
  // to the full-time score (otherwise omitted; never inferred).
  halfTimeScore: SideTotalsSchema.extend({ home: z.number().int(), away: z.number().int() }).optional(),
  events: z.array(BriefEventSchema),
  stats: z.object({
    goals: SideTotalsSchema,
    yellowCards: SideTotalsSchema,
    redCards: SideTotalsSchema,
    corners: SideTotalsSchema,
    // Per-half corner split, present only when period keys reconcile.
    cornersByHalf: z
      .object({ first: SideTotalsSchema, second: SideTotalsSchema })
      .optional(),
  }),
  oddsTimeline: z.array(
    z.object({ minute: z.number(), homeWin: z.number(), draw: z.number(), awayWin: z.number() })
  ),
  oddsHighlights: z.array(
    z.object({ minute: z.number(), description: z.string(), swing: z.number() })
  ),
  // Honest, machine-readable notes about what the source data does NOT contain,
  // so the LLM can be told plainly not to invent it.
  dataNotes: z.array(z.string()),
});
export type MatchBrief = z.infer<typeof MatchBriefSchema>;
