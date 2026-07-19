// The 2026 World Cup knockout bracket, keyed by TxLINE fixtureId.
//
// TxLINE's feed carries no round/stage label — only a FixtureGroupId that
// clusters each round. We resolved those groups to real rounds once (see the
// table below) and freeze the mapping here. Scores, events and on-chain proofs
// for every PLAYED match still come live from the verified brief; only the round
// LABEL and the not-yet-played Final placeholder are declared statically.
//
//   FixtureGroupId 10115574 → Round of 16   (8)
//   FixtureGroupId 10115675 → Quarter-final (4)
//   FixtureGroupId 10115573 → Semi-final    (2)
//   FixtureGroupId 10115771 → Third-place   (1)
//   FixtureGroupId 10115676 → Final         (1, unplayed as of 2026-07-19)

export type Stage =
  | "Final"
  | "Third-place play-off"
  | "Semi-final"
  | "Quarter-final"
  | "Round of 16"
  | "Group stage";

// Render order on the matches page: finals first, down to the round of 16.
export const STAGE_ORDER: Stage[] = [
  "Final",
  "Third-place play-off",
  "Semi-final",
  "Quarter-final",
  "Round of 16",
  "Group stage",
];

// Short caption shown under each section heading.
export const STAGE_BLURB: Record<Stage, string> = {
  Final: "One match for the trophy.",
  "Third-place play-off": "The losing semi-finalists meet for the bronze.",
  "Semi-final": "Two ties; the winners reach the Final.",
  "Quarter-final": "The last eight.",
  "Round of 16": "The knockout stage begins.",
  "Group stage": "Verified group-stage fixtures with studio narration.",
};

// fixtureId → knockout stage. Anything not listed is treated as "Group stage".
export const KNOCKOUT_STAGE: Record<string, Stage> = {
  // Round of 16
  "18185036": "Round of 16", // Canada 0–3 Morocco
  "18188721": "Round of 16", // Paraguay 0–1 France
  "18187298": "Round of 16", // Brazil 1–2 Norway
  "18192996": "Round of 16", // Mexico 2–3 England
  "18198205": "Round of 16", // Portugal 0–1 Spain
  "18193785": "Round of 16", // USA 1–4 Belgium
  "18202701": "Round of 16", // Argentina 3–2 Egypt
  "18202783": "Round of 16", // Switzerland 0–0 Colombia
  // Quarter-finals
  "18209181": "Quarter-final", // France 2–0 Morocco
  "18218149": "Quarter-final", // Spain 2–1 Belgium
  "18213979": "Quarter-final", // Norway 1–2 England
  "18222446": "Quarter-final", // Argentina 3–1 Switzerland
  // Semi-finals
  "18237038": "Semi-final", // France 0–2 Spain
  "18241006": "Semi-final", // England 1–2 Argentina
  // Third-place play-off
  "18257865": "Third-place play-off", // France 4–6 England
  // Final
  "18257739": "Final", // Spain vs Argentina — not yet played
};

export function stageFor(fixtureId: string): Stage {
  return KNOCKOUT_STAGE[fixtureId] ?? "Group stage";
}

// The Final has not been played, so there is no verified brief for it yet. It is
// rendered as a locked "awaiting result" card (normal recap flow only unlocks
// once real on-chain data exists).
export type UpcomingMatch = {
  matchId: string;
  stage: Stage;
  competition: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
};

// The Final (18257739, Spain 1-0 Argentina) has now been played and has a
// verified brief, so it renders as a normal played match. No fixtures remain
// upcoming.
export const UPCOMING: UpcomingMatch[] = [];
