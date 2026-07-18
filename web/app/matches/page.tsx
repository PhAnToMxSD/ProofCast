import Link from "next/link";
import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import { Flag } from "@/components/Flag";

export const metadata: Metadata = {
  title: "Matches — ProofCast",
  description: "Pick a verified World Cup fixture to hear its recap.",
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MatchesPage() {
  const matches = getCatalog();

  return (
    <main className="shell">
      <div className="crumbs">
        <Link href="/" className="back-link">← Home</Link>
      </div>

      <header className="page-head">
        <h1>Pick a match</h1>
        <p className="lede">
          {matches.length} verified World Cup fixtures. Choose one to pick a narrator and hear
          the recap — every fact links to its on-chain proof.
        </p>
      </header>

      <div className="match-grid">
        {matches.map((m) => {
          const goals = m.events.filter((e) => e.type === "goal").length;
          return (
            <Link key={m.matchId} href={`/match/${m.matchId}`} className="match-card">
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
        })}
      </div>
    </main>
  );
}
