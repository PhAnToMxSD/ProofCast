"use client";

// The pitch, literally: every fact the commentator cited, with its on-chain
// receipt. Each row links to the Solana Explorer account holding the published
// Merkle root (devnet) and to the TxLINE stat-validation endpoint that returns
// the full Merkle proof for that exact stat.

import type { CatalogMatch } from "@/lib/catalog";
import type { Recap } from "@/lib/pipeline/recap";

const EVENT_META: Record<string, { icon: string; label: string }> = {
  goal: { icon: "⚽", label: "Goal" },
  penalty: { icon: "🎯", label: "Penalty" },
  yellow: { icon: "🟨", label: "Yellow card" },
  red: { icon: "🟥", label: "Red card" },
  substitution: { icon: "🔁", label: "Substitution" },
  var: { icon: "📺", label: "VAR check" },
};

export function Receipts({ recap, match }: { recap: Recap; match: CatalogMatch }) {
  const eventsById = new Map(match.events.map((e) => [e.id, e]));

  return (
    <section className="receipts">
      <h3>
        <span aria-hidden="true">🧾</span> On-chain receipts
      </h3>
      <p className="intro">
        Every fact in this recap was cited against verified TxLINE data. Each receipt
        resolves to the Merkle root published on Solana devnet and the proof for that
        exact stat — nothing here is on the AI&apos;s word alone.
      </p>
      <ul className="receipt-list">
        {recap.citations.map((c, i) => {
          const ev = c.eventId ? eventsById.get(c.eventId) : undefined;
          const meta = ev ? EVENT_META[ev.type] ?? { icon: "📌", label: ev.type } : null;
          const isFinal = c.kind === "final" || !ev || !meta;
          const icon = isFinal ? "🏁" : meta.icon;
          const min = !isFinal && ev.minute != null ? `${ev.minute}'` : null;
          // Headline the scorer when we have one; otherwise the team.
          const who = !isFinal ? ev.scorer ?? ev.teamName : "";
          const kind = isFinal ? "Full-time score" : `${meta.label} — ${who}`;
          const sub = isFinal
            ? `${match.homeTeam} ${match.finalScore.home}–${match.finalScore.away} ${match.awayTeam}`
            : `${ev.scorer ? `${ev.teamName} · ` : ""}made it ${ev.homeScore}–${ev.awayScore}${ev.detail ? ` · ${ev.detail}` : ""}`;
          return (
            <li
              className="receipt"
              key={c.marker}
              style={{ animationDelay: `${0.08 * i}s` }}
            >
              <span className="icon" aria-hidden="true">
                {min ? <span className="minute">{min}</span> : icon}
              </span>
              <span className="what">
                <span className="kind">{kind}</span>
                <span className="sub">{sub}</span>
                {!isFinal && ev.scorer && (
                  <span className="name-source">
                    🔒 goal, team &amp; minute verified on-chain · scorer name via{" "}
                    {ev.nameSource ?? "match report"}
                  </span>
                )}
              </span>
              <span className="links">
                <a href={c.proof.explorerUrl} target="_blank" rel="noreferrer">
                  Explorer ↗
                </a>
                <a
                  href={`/api/proof?fixtureId=${c.proof.fixtureId}&seq=${c.proof.seq}&statKey=${c.proof.statKey}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Merkle proof ↗
                </a>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
