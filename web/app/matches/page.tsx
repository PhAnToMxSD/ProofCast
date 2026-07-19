import Link from "next/link";
import type { Metadata } from "next";
import { getCatalog, type CatalogMatch } from "@/lib/catalog";
import { STAGE_ORDER, STAGE_BLURB, UPCOMING, type Stage, type UpcomingMatch } from "@/lib/knockout";
import { Flag } from "@/components/Flag";

export const metadata: Metadata = {
  title: "Matches — ProofCast",
  description: "Pick a verified World Cup fixture — group stage to the final — for its full on-chain stats sheet and an AI recap.",
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function PlayedCard({ m }: { m: CatalogMatch }) {
  const goals = m.events.filter((e) => e.type === "goal").length;
  return (
    <Link href={`/match/${m.matchId}`} className="match-card">
      <span className="fixture">
        <span className="side">
          <Flag team={m.homeTeam} size={44} />
          <span className="name">{m.homeTeam}</span>
        </span>
        <span className="score">
          {m.finalScore.home}–{m.finalScore.away}
        </span>
        <span className="side">
          <Flag team={m.awayTeam} size={44} />
          <span className="name">{m.awayTeam}</span>
        </span>
      </span>
      <span className="meta">
        <span>{fmtDate(m.date)}</span>
        {m.audioStyles.length > 0 ? (
          <span className="has-audio">♪ studio audio</span>
        ) : (
          <span>{m.competition}</span>
        )}
      </span>
      <span className="match-stub">
        <span>
          {goals} goals · {m.events.length} events
        </span>
        <span className="verified">✓ on-chain</span>
      </span>
    </Link>
  );
}

function UpcomingCard({ m }: { m: UpcomingMatch }) {
  return (
    <div className="match-card locked" aria-disabled="true">
      <span className="fixture">
        <span className="side">
          <Flag team={m.homeTeam} size={44} />
          <span className="name">{m.homeTeam}</span>
        </span>
        <span className="score pending">vs</span>
        <span className="side">
          <Flag team={m.awayTeam} size={44} />
          <span className="name">{m.awayTeam}</span>
        </span>
      </span>
      <span className="meta">
        <span>{fmtDate(m.date)}</span>
        <span>{m.competition}</span>
      </span>
      <span className="match-stub">
        <span>Awaiting kick-off</span>
        <span className="pending-tag">⏳ not played yet</span>
      </span>
    </div>
  );
}

export default function MatchesPage() {
  const matches = getCatalog();

  // Group played matches by stage, plus the not-yet-played placeholders.
  const byStage = new Map<Stage, { played: CatalogMatch[]; upcoming: UpcomingMatch[] }>();
  for (const stage of STAGE_ORDER) byStage.set(stage, { played: [], upcoming: [] });
  for (const m of matches) byStage.get(m.stage)?.played.push(m);
  for (const u of UPCOMING) byStage.get(u.stage)?.upcoming.push(u);

  const knockoutCount =
    matches.filter((m) => m.stage !== "Group stage").length + UPCOMING.length;

  return (
    <main className="shell">
      <div className="crumbs">
        <Link href="/" className="back-link">← Home</Link>
      </div>

      <header className="page-head with-trophy">
        <div className="page-head-text">
          <h1>Pick a match</h1>
          <p className="lede">
            The full 2026 World Cup knockout run — {knockoutCount} ties from the Round of 16 to the
            Final — plus the verified group-stage fixtures. Open any played match for its complete
            stats sheet — possession, shots, corners, cards and goals — then pick a narrator and brew
            its recap; every figure and every fact links to its on-chain proof.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="head-trophy-img" src="/trophy.png" alt="FIFA World Cup trophy" />
      </header>

      {STAGE_ORDER.map((stage) => {
        const bucket = byStage.get(stage);
        if (!bucket || (bucket.played.length === 0 && bucket.upcoming.length === 0)) return null;
        const total = bucket.played.length + bucket.upcoming.length;
        return (
          <section key={stage} className="stage-section">
            <div className="stage-heading">
              <h2>{stage}</h2>
              <span className="stage-count">{total}</span>
              <span className="stage-blurb">{STAGE_BLURB[stage]}</span>
            </div>
            <div className="match-grid">
              {bucket.upcoming.map((u) => (
                <UpcomingCard key={u.matchId} m={u} />
              ))}
              {bucket.played.map((m) => (
                <PlayedCard key={m.matchId} m={m} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
