"use client";

// Per-match experience (one fixed fixture): pick a narrator → pick who you're
// supporting → the recap is "brewed" → scoreboard + narration + transcript +
// on-chain receipts. Cached preset combinations answer instantly from committed
// pipeline output; a favourite-team personalization runs the live pipeline
// through /api/recap.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogMatch, MatchStats } from "@/lib/catalog";
import type { Recap } from "@/lib/pipeline/recap";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Flag } from "@/components/Flag";
import { Receipts } from "@/components/Receipts";
import { TeamStats } from "@/components/TeamStats";

type StyleKey = "hype" | "analyst" | "bedtime";
type RecapResult = { recap: Recap; audioUrl: string | null; source: "cache" | "live" };

const PERSONAS: Array<{ key: StyleKey; icon: string; label: string; blurb: string }> = [
  { key: "hype", icon: "📣", label: "Hype Commentator", blurb: "Explosive and partisan — lives and dies with every goal." },
  { key: "analyst", icon: "📊", label: "Deadpan Stats Nerd", blurb: "Dry, precise, quietly obsessed with corners and cards." },
  { key: "bedtime", icon: "🌙", label: "Bedtime Story", blurb: "The match retold as a gentle fairy tale, at a lullaby pace." },
];

const BREWING_MSGS = [
  "Brewing your recap…",
  "Warming up the commentary box…",
  "Checking every receipt on-chain…",
  "Consulting the fourth official…",
  "Cueing the crowd noise…",
];

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Final score that counts up when the board is revealed.
function CountUpScore({ home, away }: { home: number; away: number }) {
  const [shown, setShown] = useState({ home: 0, away: 0 });
  useEffect(() => {
    const start = performance.now();
    const DURATION = 1100;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      const ease = 1 - Math.pow(1 - p, 3);
      setShown({ home: Math.round(home * ease), away: Math.round(away * ease) });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [home, away]);
  return (
    <div className="digits">
      <span>{shown.home}</span>
      <span className="colon">:</span>
      <span>{shown.away}</span>
    </div>
  );
}

function Brewing() {
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMsg((m) => (m + 1) % BREWING_MSGS.length), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="pitch-strip">
        <span className="rolling-ball" aria-hidden="true">⚽</span>
      </div>
      <span className="msg">{BREWING_MSGS[msg]}</span>
    </div>
  );
}

export function MatchExperience({ match, stats }: { match: CatalogMatch; stats: MatchStats | null }) {
  const [style, setStyle] = useState<StyleKey | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<RecapResult | null>(null);
  const [error, setError] = useState("");

  const stageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const ready = Boolean(style);

  // Audio-reactive hook-up: the player streams energy here; we hand it to the
  // scoreboard as a CSS custom property (no React re-render per frame).
  const handleEnergy = useCallback((e: number) => {
    boardRef.current?.style.setProperty("--energy", e.toFixed(3));
  }, []);

  const generate = async () => {
    if (!style) return;
    setPhase("loading");
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.matchId, style }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      setResult(body as RecapResult);
      setPhase("done");
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const paragraphs = result?.recap.text.split(/\n{2,}|\n/).filter((p) => p.trim()) ?? [];

  return (
    <div className="shell">
      <div className="crumbs">
        <Link href="/matches" className="back-link">← All matches</Link>
      </div>

      {/* ── Fixture header ── */}
      <header className="match-hero">
        <div className="fixture-line">
          <span className="side">
            <Flag team={match.homeTeam} size={56} />
            <span className="name">{match.homeTeam}</span>
          </span>
          <span className="vs">vs</span>
          <span className="side">
            <Flag team={match.awayTeam} size={56} />
            <span className="name">{match.awayTeam}</span>
          </span>
        </div>
        <p className="match-meta">
          {match.competition} · {fmtDate(match.date)} · full-time
          <a className="verified-badge sm" href={match.finalExplorerUrl} target="_blank" rel="noreferrer">
            <span aria-hidden="true">🛡</span> Verified on-chain
          </a>
        </p>
      </header>

      {/* ── Verified match statistics (always visible) ── */}
      {stats && <TeamStats match={match} stats={stats} />}

      {/* ── Step 1: narrator ── */}
      <section className="step">
        <div className="step-head">
          <span className="step-num">1</span>
          <h2>Pick your commentator</h2>
          <span className="hint">same facts, different voice</span>
        </div>
        <div className="persona-grid">
          {PERSONAS.map((p) => {
            const cached = match.cachedStyles.includes(p.key);
            return (
              <button
                key={p.key}
                className={`persona-card ${style === p.key ? "selected" : ""}`}
                onClick={() => setStyle(p.key)}
                aria-pressed={style === p.key}
              >
                <span className="icon" aria-hidden="true">{p.icon}</span>
                <h3>{p.label}</h3>
                <p>{p.blurb}</p>
                {cached ? (
                  <span className="tag">⚡ instant — pre-verified</span>
                ) : (
                  <span className="tag live">● generated live</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Step 2: brew ── */}
      <div className="kickoff-row">
        {phase === "loading" ? (
          <Brewing />
        ) : (
          <>
            <button className="kickoff" disabled={!ready} onClick={generate}>
              <span aria-hidden="true">⚽</span> {phase === "done" ? "Brew another take" : "Brew the recap"}
            </button>
            <span className="kickoff-note">
              Pre-verified combinations play instantly from the committed pipeline output.
            </span>
          </>
        )}
      </div>

      {phase === "error" && (
        <div className="error-card" role="alert">
          <h3>📺 VAR check failed</h3>
          <p>{error}</p>
        </div>
      )}

      {/* ── Result stage ── */}
      {phase === "done" && result && (
        <div className="stage" ref={stageRef}>
          <div className="scoreboard" ref={boardRef}>
            <div className="board">
              <div className="team">
                <span className="flag-wrap"><Flag team={match.homeTeam} size={92} /></span>
                <span className="name">{match.homeTeam}</span>
              </div>
              <div className="mid">
                <CountUpScore home={match.finalScore.home} away={match.finalScore.away} />
                <span className="stage-ball" aria-hidden="true">⚽</span>
              </div>
              <div className="team">
                <span className="flag-wrap"><Flag team={match.awayTeam} size={92} /></span>
                <span className="name">{match.awayTeam}</span>
              </div>
            </div>
            <div className="sub">
              <span>{match.competition} · {fmtDate(match.date)} · full-time</span>
              <a className="verified-badge" href={match.finalExplorerUrl} target="_blank" rel="noreferrer">
                <span aria-hidden="true">🛡</span> Verified on-chain
              </a>
            </div>
          </div>

          <AudioPlayer
            key={`${result.recap.matchId}-${result.recap.style}-${result.recap.generatedAt ?? ""}`}
            matchId={match.matchId}
            audioUrl={result.audioUrl}
            text={result.recap.text}
            styleKey={result.recap.style}
            onEnergy={handleEnergy}
          />

          <section className="transcript">
            <h3>
              <span aria-hidden="true">🎙</span> {result.recap.styleLabel} —{" "}
              {result.source === "cache" ? "pre-verified recap" : "brewed live"}
            </h3>
            {paragraphs.map((p, i) => (
              <p key={i} style={{ animationDelay: `${0.12 * i}s` }}>{p}</p>
            ))}
          </section>

          <Receipts recap={result.recap} match={match} />
        </div>
      )}
    </div>
  );
}
