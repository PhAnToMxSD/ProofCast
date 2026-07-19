// Server-side view of the synced pipeline cache: the match list handed to the
// page, with everything the client needs to render scoreboards and receipts.

import data from "@/lib/generated/data.json";
import type { MatchBrief } from "@/lib/pipeline/types";
import { stageFor, type Stage } from "@/lib/knockout";

export type CatalogEvent = {
  id: string;
  type: string;
  team: "home" | "away";
  teamName: string;
  homeScore: number;
  awayScore: number;
  minute: number | null; // real match minute (on-chain-anchored), when the feed carries it
  scorer: string | null; // web2-attributed name, aligned to this verified event
  nameSource: string | null; // provenance of `scorer` (e.g. "FIFA / ESPN")
  detail: string | null;
  explorerUrl: string;
  proofApiUrl: string;
};

export type StatProof = {
  fixtureId: number;
  seq: number;
  statKey: number;
  explorerUrl: string;
  statValidationUrl: string;
};

export type TeamStatRow = {
  key: string;
  label: string;
  home: number;
  away: number;
  unit?: string;
  kind: "verified" | "derived";
  events?: number;
  proofHome?: StatProof;
  proofAway?: StatProof;
};

export type MatchStats = {
  matchId: string;
  stats: TeamStatRow[];
  source: string;
};

export type CatalogMatch = {
  matchId: string;
  competition: string;
  stage: Stage;
  date: string;
  homeTeam: string;
  awayTeam: string;
  finalScore: { home: number; away: number };
  finalExplorerUrl: string;
  finalProofApiUrl: string;
  events: CatalogEvent[];
  cachedStyles: string[]; // styles with a committed text recap
  audioStyles: string[]; // styles with a committed ElevenLabs mp3
};

const briefs = data.briefs as unknown as Record<string, MatchBrief>;

function stylesFor(map: Record<string, unknown>, matchId: string): string[] {
  const prefix = `${matchId}-`;
  return Object.keys(map)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

export function getCatalog(): CatalogMatch[] {
  return Object.values(briefs)
    .map((b) => ({
      matchId: b.matchId,
      competition: b.competition,
      stage: stageFor(b.matchId),
      date: b.date,
      homeTeam: b.homeTeam,
      awayTeam: b.awayTeam,
      finalScore: b.finalScore,
      finalExplorerUrl: b.finalScoreProof.explorerUrl,
      finalProofApiUrl: b.finalScoreProof.statValidationUrl,
      events: b.events.map((e) => ({
        id: e.id,
        type: e.type,
        team: e.team,
        teamName: e.teamName,
        homeScore: e.homeScore,
        awayScore: e.awayScore,
        minute: e.minute ?? null,
        scorer: e.scorer ?? null,
        nameSource: e.nameSource ?? null,
        detail: e.detail ?? null,
        explorerUrl: e.proof.explorerUrl,
        proofApiUrl: e.proof.statValidationUrl,
      })),
      cachedStyles: stylesFor(data.recaps as Record<string, unknown>, b.matchId),
      audioStyles: stylesFor(data.audio as Record<string, unknown>, b.matchId),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

const statsMap = (data as { stats?: Record<string, MatchStats> }).stats ?? {};

/** The verified-on-chain team-stats panel for a match, or null if none. */
export function getMatchStats(matchId: string): MatchStats | null {
  return (statsMap[matchId] as MatchStats) ?? null;
}
