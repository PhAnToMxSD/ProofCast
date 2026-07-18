"use client";

// The whole Phase 7 experience: pick a match → pick a persona → generate →
// scoreboard + narration + transcript + on-chain receipts. Cached combinations
// answer instantly from committed pipeline output; anything personalized runs
// the live pipeline through /api/recap.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogMatch } from "@/lib/catalog";
import type { Recap } from "@/lib/pipeline/recap";
import { AudioPlayer } from "@/components/AudioPlayer";
import { Flag } from "@/components/Flag";
import { Receipts } from "@/components/Receipts";

type StyleKey = "hype" | "analyst" | "bedtime";
type Favourite = "none" | "home" | "away";
type RecapResult = { recap: Recap; audioUrl: string | null; source: "cache" | "live" };

const PERSONAS: Array<{ key: StyleKey; icon: string; label: string; blurb: string }> = [
  {
    key: "hype",
    icon: "📣",
    label: "Hype Commentator",
    blurb: "Explosive and partisan — lives and dies with every goal.",
  },
  {
    key: "analyst",
    icon: "📊",
    label: "Deadpan Stats Nerd",
    blurb: "Dry, precise, quietly obsessed with corners and cards.",
  },
  {
    key: "bedtime",
    icon: "🌙",
    label: "Bedtime Story",
    blurb: "The match retold as a gentle fairy tale, at a lullaby pace.",
  },
];

const LOADING_MSGS = [
  "Rolling the ball out of the tunnel…",
  "Warming up the commentary box…",
  "Checking every receipt on-chain…",
  "Consulting the fourth official…",
  "Cueing the crowd noise…",
];

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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

function Loader() {
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMsg((m) => (m + 1) % LOADING_MSGS.length), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="loader" role="status">
      <div className="pitch-strip">
        <span className="rolling-ball" aria-hidden="true">
          ⚽
        </span>
      </div>
      <span className="msg">{LOADING_MSGS[msg]}</span>
    </div>
  );
}

export function Experience({ matches }: { matches: CatalogMatch[] }) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [style, setStyle] = useState<StyleKey | null>(null);
  const [favourite, setFavourite] = useState<Favourite>("none");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<RecapResult | null>(null);
  const [error, setError] = useState("");

  const stageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const match = matches.find((m) => m.matchId === matchId) ?? null;
  const isLivePath = favourite !== "none";
  const ready = Boolean(match && style);

  // Audio-reactive hook-up: the player streams energy here; we hand it to the
  // scoreboard as a CSS custom property (no React re-render per frame).
  const handleEnergy = useCallback((e: number) => {
    boardRef.current?.style.setProperty("--energy", e.toFixed(3));
  }, []);

  const generate = async () => {
    if (!match || !style) return;
    setPhase("loading");
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.matchId,
          style,
          ...(favourite !== "none"
            ? { favouriteTeam: favourite === "home" ? match.homeTeam : match.awayTeam }
            : {}),
        }),
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
      {/* ── Hero ── */}
      <header className="hero">
        <h1>
          <span className="ball" aria-hidden="true">
            ⚽
          </span>
          ProofCast
        </h1>
        <p className="tagline">
          AI matchday recaps where <strong>every sentence has a receipt</strong> — built
          from cryptographically verified TxLINE match data and provable on Solana.
        </p>
        <div className="badges">
          <span className="pill grass">✓ TxLINE primary data</span>
          <span className="pill">Solana devnet</span>
          <span className="pill">ElevenLabs narration</span>
        </div>
      </header>

      {/* ── Step 1: match ── */}
      <section className="step">
        <div className="step-head">
          <span className="step-num">1</span>
          <h2>Pick a match</h2>
          <span className="hint">World Cup 2026 · verified fixtures</span>
        </div>
        <div className="match-grid">
          {matches.map((m) => (
            <button
              key={m.matchId}
              className={`match-card ${matchId === m.matchId ? "selected" : ""}`}
              onClick={() => setMatchId(m.matchId)}
              aria-pressed={matchId === m.matchId}
            >
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
            </button>
          ))}
        </div>
      </section>

      {/* ── Step 2: persona ── */}
      <section className="step">
        <div className="step-head">
          <span className="step-num">2</span>
          <h2>Pick your commentator</h2>
          <span className="hint">same facts, different voice</span>
        </div>
        <div className="persona-grid">
          {PERSONAS.map((p) => {
            const cached = match ? match.cachedStyles.includes(p.key) : false;
            return (
              <button
                key={p.key}
                className={`persona-card ${style === p.key ? "selected" : ""}`}
                onClick={() => setStyle(p.key)}
                aria-pressed={style === p.key}
              >
                <span className="icon" aria-hidden="true">
                  {p.icon}
                </span>
                <h3>{p.label}</h3>
                <p>{p.blurb}</p>
                {match &&
                  (cached ? (
                    <span className="tag">⚡ instant — pre-verified</span>
                  ) : (
                    <span className="tag live">● generated live</span>
                  ))}
              </button>
            );
          })}
        </div>

        <div className="options">
          <span className="label">Supporting:</span>
          <div className="segmented" role="group" aria-label="Favourite team">
            <button
              className={favourite === "none" ? "active" : ""}
              onClick={() => setFavourite("none")}
            >
              Neutral
            </button>
            <button
              className={favourite === "home" ? "active" : ""}
              onClick={() => setFavourite("home")}
              disabled={!match}
            >
              {match && <Flag team={match.homeTeam} size={18} />}
              {match?.homeTeam ?? "Home"}
            </button>
            <button
              className={favourite === "away" ? "active" : ""}
              onClick={() => setFavourite("away")}
              disabled={!match}
            >
              {match && <Flag team={match.awayTeam} size={18} />}
              {match?.awayTeam ?? "Away"}
            </button>
          </div>
        </div>

      </section>

      {/* ── Step 3: kickoff ── */}
      <div className="kickoff-row">
        {phase === "loading" ? (
          <Loader />
        ) : (
          <>
            <button className="kickoff" disabled={!ready} onClick={generate}>
              <span aria-hidden="true">⚽</span> Kick off the recap
            </button>
            <span className="kickoff-note">
              {isLivePath
                ? "Personalized — generated live by the grounded pipeline (needs the server's OpenRouter key)."
                : "Pre-verified combinations play instantly from the committed pipeline output."}
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
      {phase === "done" && result && match && (
        <div className="stage" ref={stageRef}>
          <div className="scoreboard" ref={boardRef}>
            <div className="board">
              <div className="team">
                <span className="flag-wrap">
                  <Flag team={match.homeTeam} size={92} />
                </span>
                <span className="name">{match.homeTeam}</span>
              </div>
              <div className="mid">
                <CountUpScore home={match.finalScore.home} away={match.finalScore.away} />
                <span className="stage-ball" aria-hidden="true">
                  ⚽
                </span>
              </div>
              <div className="team">
                <span className="flag-wrap">
                  <Flag team={match.awayTeam} size={92} />
                </span>
                <span className="name">{match.awayTeam}</span>
              </div>
            </div>
            <div className="sub">
              <span>
                {match.competition} · {fmtDate(match.date)} · full-time
              </span>
              <a
                className="verified-badge"
                href={match.finalExplorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span aria-hidden="true">🛡</span> Verified on-chain
              </a>
            </div>
          </div>

          <AudioPlayer
            key={`${result.recap.matchId}-${result.recap.style}-${result.recap.generatedAt ?? ""}`}
            audioUrl={result.audioUrl}
            text={result.recap.text}
            styleKey={result.recap.style}
            onEnergy={handleEnergy}
          />

          <section className="transcript">
            <h3>
              <span aria-hidden="true">🎙</span> {result.recap.styleLabel} —{" "}
              {result.source === "cache" ? "pre-verified recap" : "generated live"}
            </h3>
            {paragraphs.map((p, i) => (
              <p key={i} style={{ animationDelay: `${0.12 * i}s` }}>
                {p}
              </p>
            ))}
          </section>

          <Receipts recap={result.recap} match={match} />
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="footer">
        <p>
          ProofCast — TxODDS World Cup Hackathon build. Match data:{" "}
          <a href="https://txline-docs.txodds.com" target="_blank" rel="noreferrer">
            TxLINE
          </a>{" "}
          (primary input, Solana devnet proofs) · Narration audio generated with{" "}
          <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">
            ElevenLabs
          </a>{" "}
          · Recaps cite only verified data — every fact links to its Merkle proof.
        </p>
      </footer>
    </div>
  );
}
