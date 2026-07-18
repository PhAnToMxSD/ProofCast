// Phase 3 — fetch completed TxLINE matches into a raw, cache-able bundle.
//
// Devnet reality (verified against live data, not the OpenAPI camelCase schema):
//   · Score records are PascalCase: FixtureId, Seq, Action, Ts, Data, Stats, …
//   · GET /scores/snapshot/{id} returns the LATEST record per Action type. For a
//     completed match this includes a `status` record whose `Stats` map holds the
//     final score + every per-period statKey, and a `game_finalised` record.
//   · The full ordered timeline is reconstructed by scanning
//     GET /scores/updates/{epochDay}/{hourOfDay}/{interval}?fixtureId=… across the
//     match window (the per-fixture updates endpoint is a live SSE stream, useless
//     for finished games).
//   · Every record carries Seq + Ts; the Stats map keys ARE the statKeys used by
//     /scores/stat-validation. So the proof coordinate for any moment is
//     { fixtureId, seq, statKey } — no per-event txSig exists.
//   · Odds and player-name/minute fields are often empty in devnet specimen data;
//     we capture whatever is present and never fabricate the rest.

import type { AxiosInstance } from "axios";

export const WORLD_CUP_COMPETITION_ID = 72;

// Soccer stat keys (whole-game totals). See README.
export const STAT_KEY = {
  homeGoals: 1, awayGoals: 2,
  homeYellow: 3, awayYellow: 4,
  homeRed: 5, awayRed: 6,
  homeCorner: 7, awayCorner: 8,
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export type ScoreRecord = {
  FixtureId: number;
  Action: string;
  Seq: number;
  Ts: number;
  StatusId?: number;
  Data?: Record<string, any>;
  Stats?: Record<string, number>;
  ScoreSoccer?: any;
  [k: string]: any;
};

export type KeyEvent = {
  type: "goal" | "yellow" | "red" | "substitution" | "penalty" | "var";
  team: "home" | "away" | "unknown";
  seq: number; // proof coordinate — the score-update sequence this event landed on
  ts: number; // on-chain-anchored timestamp (ms)
  statKey?: number; // the provable statKey whose value changed at this seq
  homeScore: number; // running score AFTER this event
  awayScore: number;
  playerId?: number;
  minute?: number;
  detail?: string;
};

export type RawMatch = {
  fixtureId: number;
  competition: string;
  competitionId: number;
  homeTeam: string;
  awayTeam: string;
  participant1Id: number;
  participant2Id: number;
  participant1IsHome: boolean;
  startTime: number;
  fetchedAt: string;
  completed: boolean;
  final: { seq: number; statusId?: number; homeGoals: number; awayGoals: number; stats: Record<string, number> };
  keyEvents: KeyEvent[];
  // Raw payloads kept verbatim so Phase 4 can rebuild the brief without re-fetching.
  snapshot: ScoreRecord[];
  timeline: ScoreRecord[]; // ordered, deduped-by-Seq records that carry a Stats map
  odds: any[];
};

// ── Small helpers ────────────────────────────────────────────────────────────

const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Real match minute from the record's running match clock. Football minutes are
 * 1-indexed (0:00–0:59 = the 1st minute), so it's floor(seconds/60)+1. This
 * reproduces the officially announced minute exactly on the matches we've checked
 * (e.g. a 5591s goal → 94', i.e. 90+4). The clock is on-chain-anchored via the
 * same record whose Seq/Stats we prove, so the minute rides on the same receipt.
 */
function minuteFromClock(r: ScoreRecord): number | undefined {
  const secs = r?.Clock?.Seconds;
  return isNum(secs) ? Math.floor(secs / 60) + 1 : undefined;
}

function teamNames(rec: ScoreRecord, p1: string, p2: string) {
  return rec.Participant1IsHome ? { home: p1, away: p2 } : { home: p2, away: p1 };
}

/** Map a Participant-1/2 statKey pair to home/away using Participant1IsHome. */
function homeAwayKeys(p1IsHome: boolean, p1Key: number, p2Key: number) {
  return p1IsHome ? { home: p1Key, away: p2Key } : { home: p2Key, away: p1Key };
}

// ── Listing completed matches ────────────────────────────────────────────────

export type CompletedSummary = {
  fixtureId: number;
  competition: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
};

/**
 * Scan the fixture list and return matches that are actually finished
 * (a `game_finalised`/`status` record present), newest window first.
 */
export async function listCompleted(
  api: AxiosInstance,
  opts: { competitionId?: number; startEpochDay?: number; limit?: number } = {}
): Promise<CompletedSummary[]> {
  const comp = opts.competitionId ?? WORLD_CUP_COMPETITION_ID;
  const today = Math.floor(Date.now() / 86400000);
  const sed = opts.startEpochDay ?? today - 30;
  const limit = opts.limit ?? 10;

  const fixtures: any[] = (
    await api.get(`/fixtures/snapshot?competitionId=${comp}&startEpochDay=${sed}`)
  ).data;

  const out: CompletedSummary[] = [];
  for (const f of fixtures) {
    if (out.length >= limit) break;
    try {
      const snap: ScoreRecord[] = (await api.get(`/scores/snapshot/${f.FixtureId}`)).data;
      if (!Array.isArray(snap) || snap.length === 0) continue;
      const finalised = snap.some((s) => s.Action === "game_finalised");
      const status = snap.find((s) => s.Action === "status");
      if (!finalised || !status?.Stats) continue;
      const p1g = Number(status.Stats["1"] ?? 0);
      const p2g = Number(status.Stats["2"] ?? 0);
      const { home, away } = teamNames(status, f.Participant1, f.Participant2);
      out.push({
        fixtureId: f.FixtureId,
        competition: f.Competition,
        home,
        away,
        homeGoals: status.Participant1IsHome ? p1g : p2g,
        awayGoals: status.Participant1IsHome ? p2g : p1g,
      });
    } catch {
      /* skip unreadable fixtures */
    }
  }
  return out;
}

// ── Timeline reconstruction (interval scan) ──────────────────────────────────

async function scanTimeline(
  api: AxiosInstance,
  fixtureId: number,
  startTimeMs: number,
  hoursToScan = 4
): Promise<ScoreRecord[]> {
  const startDay = Math.floor(startTimeMs / 86400000);
  const startHour = new Date(startTimeMs).getUTCHours();
  const bySeq = new Map<number, ScoreRecord>();

  for (let h = 0; h < hoursToScan; h++) {
    const abs = startHour + h;
    const day = startDay + Math.floor(abs / 24);
    const hour = abs % 24;
    for (let iv = 0; iv < 12; iv++) {
      try {
        const d = (await api.get(`/scores/updates/${day}/${hour}/${iv}?fixtureId=${fixtureId}`)).data;
        if (Array.isArray(d)) for (const r of d as ScoreRecord[]) if (isNum(r?.Seq)) bySeq.set(r.Seq, r);
      } catch {
        /* empty interval */
      }
    }
  }
  return [...bySeq.values()].sort((a, b) => a.Seq - b.Seq);
}

// ── Event extraction by walking stat increments (decrement-aware) ────────────
//
// The honest, provable way to find events: watch each statKey counter climb.
// When Stats[goalKey] increases at a given Seq, THAT record is the goal, and its
// Seq is exactly what /scores/stat-validation proves. Refinement noise (repeated
// "possible goal" rows) collapses because the counter only moves once.
//
// Crucially this is decrement-aware: a VAR-disallowed goal (or a correction)
// shows up as the counter going N→N+1→N. We keep a per-key stack of tentative
// events and POP it when the counter drops, so revoked events never survive.
// After the walk, each key's surviving event count equals its final Stats value,
// keeping keyEvents consistent with the final score (no fabricated goals).

function extractKeyEvents(records: ScoreRecord[], p1IsHome: boolean): KeyEvent[] {
  const goals = homeAwayKeys(p1IsHome, STAT_KEY.homeGoals, STAT_KEY.awayGoals);
  const yellows = homeAwayKeys(p1IsHome, STAT_KEY.homeYellow, STAT_KEY.awayYellow);
  const reds = homeAwayKeys(p1IsHome, STAT_KEY.homeRed, STAT_KEY.awayRed);

  const tracked: Array<{ type: KeyEvent["type"]; team: KeyEvent["team"]; key: number }> = [
    { type: "goal", team: "home", key: goals.home },
    { type: "goal", team: "away", key: goals.away },
    { type: "yellow", team: "home", key: yellows.home },
    { type: "yellow", team: "away", key: yellows.away },
    { type: "red", team: "home", key: reds.home },
    { type: "red", team: "away", key: reds.away },
  ];

  const prev: Record<number, number> = {};
  const stacks = new Map<number, KeyEvent[]>(); // per-key stack of surviving events
  for (const c of tracked) stacks.set(c.key, []);

  for (const r of records) {
    if (!r.Stats) continue;
    for (const c of tracked) {
      if (!(String(c.key) in r.Stats)) continue; // key absent this record → no change
      const now = Number(r.Stats[String(c.key)]);
      const before = prev[c.key] ?? 0;
      const stack = stacks.get(c.key)!;
      if (now > before) {
        for (let i = before + 1; i <= now; i++) {
          stack.push({
            type: c.type,
            team: c.team,
            seq: r.Seq,
            ts: r.Ts,
            statKey: c.key,
            homeScore: 0, // filled in after reconciliation
            awayScore: 0,
            playerId: isNum(r.Data?.PlayerId) ? r.Data!.PlayerId : undefined,
            // Prefer an explicit Data.Minutes if the feed ever carries one; else
            // derive from the running match clock (the usual devnet case).
            minute: isNum(r.Data?.Minutes) ? r.Data!.Minutes : minuteFromClock(r),
            detail: typeof r.Data?.GoalType === "string" ? r.Data!.GoalType : undefined,
          });
        }
      } else if (now < before) {
        stack.splice(now); // counter dropped → discard the revoked event(s)
      }
      prev[c.key] = now;
    }
  }

  // Flatten surviving events, order by seq, and recompute the running score.
  const events = [...stacks.values()].flat().sort((a, b) => a.seq - b.seq);
  let home = 0;
  let away = 0;
  for (const e of events) {
    if (e.type === "goal") e.team === "home" ? home++ : away++;
    e.homeScore = home;
    e.awayScore = away;
  }
  return events;
}

// ── Fetch one completed match into a raw bundle ──────────────────────────────

export async function fetchMatch(api: AxiosInstance, fixtureId: number): Promise<RawMatch> {
  const snapshot: ScoreRecord[] = (await api.get(`/scores/snapshot/${fixtureId}`)).data;
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new Error(`no score data for fixture ${fixtureId}`);
  }

  const status = snapshot.find((s) => s.Action === "status");
  const anyRec = status ?? snapshot[snapshot.length - 1];
  const completed = snapshot.some((s) => s.Action === "game_finalised");

  // Fixture meta (from the fixtures list, for team names).
  const fx: any[] = (
    await api.get(`/fixtures/snapshot?competitionId=${anyRec.CompetitionId}&startEpochDay=${Math.floor((anyRec.StartTime ?? Date.now()) / 86400000) - 1}`)
  ).data;
  const fixture = fx.find((f) => f.FixtureId === fixtureId) ?? {};
  const p1 = fixture.Participant1 ?? `P${anyRec.Participant1Id}`;
  const p2 = fixture.Participant2 ?? `P${anyRec.Participant2Id}`;
  const p1IsHome = Boolean(anyRec.Participant1IsHome);
  const { home, away } = anyRec.Participant1IsHome ? { home: p1, away: p2 } : { home: p2, away: p1 };

  const stats = status?.Stats ?? {};
  const p1g = Number(stats["1"] ?? 0);
  const p2g = Number(stats["2"] ?? 0);

  const timeline = await scanTimeline(api, fixtureId, anyRec.StartTime ?? Date.now());
  const keyEvents = extractKeyEvents(timeline, p1IsHome);

  let odds: any[] = [];
  try {
    const o = (await api.get(`/odds/snapshot/${fixtureId}`)).data;
    if (Array.isArray(o)) odds = o;
  } catch {
    /* odds absent on devnet specimen data */
  }

  return {
    fixtureId,
    competition: fixture.Competition ?? "World Cup",
    competitionId: anyRec.CompetitionId,
    homeTeam: home,
    awayTeam: away,
    participant1Id: anyRec.Participant1Id,
    participant2Id: anyRec.Participant2Id,
    participant1IsHome: p1IsHome,
    startTime: anyRec.StartTime,
    fetchedAt: new Date().toISOString(),
    completed,
    final: {
      seq: status?.Seq ?? anyRec.Seq,
      statusId: status?.StatusId,
      homeGoals: p1IsHome ? p1g : p2g,
      awayGoals: p1IsHome ? p2g : p1g,
      stats,
    },
    keyEvents,
    snapshot,
    timeline: timeline.filter((r) => r.Stats && Object.keys(r.Stats).length > 0),
    odds,
  };
}
