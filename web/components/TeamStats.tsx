"use client";

// The verified team-stats panel — ProofCast's answer to a Google match-stats
// card. Every number comes from TxLINE's on-chain feed:
//   • "verified" rows (corners / cards) carry a per-stat Merkle proof link.
//   • "derived" rows (shots / on target / possession) are counted from N
//     individually-proven on-chain events; we say so rather than overclaim.
// The comparison bar makes it glanceable; the winning side gets the accent.

import { useEffect, useRef, useState } from "react";
import type { CatalogMatch, MatchStats, TeamStatRow } from "@/lib/catalog";
import { Flag } from "@/components/Flag";

function Bar({ home, away }: { home: number; away: number }) {
  const total = home + away;
  const hPct = total > 0 ? (home / total) * 100 : 50;
  const homeLeads = home > away;
  const awayLeads = away > home;
  return (
    <div className="ts-bar" role="presentation">
      <span
        className={`ts-bar-fill home ${homeLeads ? "lead" : ""}`}
        style={{ width: `${hPct}%` }}
      />
      <span
        className={`ts-bar-fill away ${awayLeads ? "lead" : ""}`}
        style={{ width: `${100 - hPct}%` }}
      />
    </div>
  );
}

function StatRow({ row, idx }: { row: TeamStatRow; idx: number }) {
  const u = row.unit ?? "";
  return (
    <li className="ts-row" style={{ animationDelay: `${0.06 * idx}s` }}>
      <div className="ts-line">
        <span className={`ts-val home ${row.home > row.away ? "lead" : ""}`}>
          {row.home}
          {u}
        </span>
        <span className="ts-label">
          {row.label}
          {row.kind === "verified" ? (
            <span className="ts-badge verified" title="Value + Merkle proof from TxLINE">
              🔒 on-chain
            </span>
          ) : (
            <span className="ts-badge derived" title={`Counted from ${row.events ?? 0} on-chain events`}>
              ⛓ {row.events ?? 0} events
            </span>
          )}
        </span>
        <span className={`ts-val away ${row.away > row.home ? "lead" : ""}`}>
          {row.away}
          {u}
        </span>
      </div>
      <Bar home={row.home} away={row.away} />
      {row.kind === "verified" && (row.proofHome || row.proofAway) && (
        <div className="ts-proof">
          {row.proofHome && (
            <a href={row.proofHome.explorerUrl} target="_blank" rel="noreferrer">
              home proof ↗
            </a>
          )}
          {row.proofAway && (
            <a href={row.proofAway.explorerUrl} target="_blank" rel="noreferrer">
              away proof ↗
            </a>
          )}
        </div>
      )}
    </li>
  );
}

export function TeamStats({ match, stats }: { match: CatalogMatch; stats: MatchStats }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  // Animate the bars in when the panel scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setShown(true),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} className={`team-stats ${shown ? "in" : ""}`} aria-label="Match statistics">
      <div className="ts-head">
        <h3>
          <span aria-hidden="true">📊</span> Match statistics
        </h3>
        <span className="ts-trust">Verified on-chain by TxLINE</span>
      </div>

      <div className="ts-teams">
        <span className="ts-team">
          <Flag team={match.homeTeam} size={26} />
          {match.homeTeam}
        </span>
        <span className="ts-team-score">
          {match.finalScore.home}–{match.finalScore.away}
        </span>
        <span className="ts-team right">
          {match.awayTeam}
          <Flag team={match.awayTeam} size={26} />
        </span>
      </div>

      <ul className="ts-list">
        {stats.stats.map((row, i) => (
          <StatRow key={row.key} row={row} idx={i} />
        ))}
      </ul>

      <p className="ts-foot">
        Corners and cards are read from TxLINE&apos;s Merkle-proven match record; shots and
        possession are tallied from individually-proven on-chain events. Nothing is scraped —
        every figure traces back to {stats.source}.
      </p>
    </section>
  );
}
