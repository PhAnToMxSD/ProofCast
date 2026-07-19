"use client";

import { useEffect, useState } from "react";

/**
 * FootballIntro — a high-octane, Blue-Lock-style anime cold-open that doubles as
 * the site's loading screen. Five acts on one CSS master timeline (--fi):
 *
 *   ACT 1 · THE RECEPTION  slow-mo, striker leaps to meet a mid-air pass, neon trails
 *   ACT 2 · THE STRIKE     he twists into a volley; foot meets ball → neon detonation + flash-cut
 *   ACT 3 · THE FLIGHT     camera follows the glowing comet as the keeper dives and is beaten
 *   ACT 4 · THE GOAL       ball rips the net; neon posts + mesh light up on impact
 *   ACT 5 · THE WIPE       the goal-glow blows out to fill the screen, then clears to reveal the UI
 *
 * All motion is CSS keyframes + inline SVG — no WebGL/canvas — so it paints on the
 * first frame and never blocks the page it sits over. The landing UI is already
 * rendered underneath; this overlay simply flashes white and unmounts to reveal it.
 *
 * Plays once per tab session (sessionStorage gate, mirrored by a blocking script in
 * layout.tsx so there's no pre-hydration flash). Honours prefers-reduced-motion and
 * offers a Skip control. Focal point (ball + goal) stays centred on every viewport.
 */
export function FootballIntro() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // The head-gate script in layout.tsx already stamped html.fi-skip when the intro
    // has run this session; trust it so we never double-play or flash on route changes.
    if (typeof window === "undefined") return;
    if (document.documentElement.classList.contains("fi-done")) return;
    if (sessionStorage.getItem("pc-intro") === "1") return;

    sessionStorage.setItem("pc-intro", "1");
    setShow(true);
    document.body.classList.add("fi-lock");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 900 : 5600;
    const t = window.setTimeout(dismiss, dur);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    document.documentElement.classList.add("fi-done");
    document.body.classList.remove("fi-lock");
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fi-root" role="presentation" aria-hidden="true" data-fi>
      <div className="fi-camera">
        {/* ---- ACT 1 · THE RECEPTION -------------------------------------- */}
        <div className="fi-stage fi-act1">
          <div className="fi-conc" />
          <svg className="fi-scene" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet">
            <SpeedTrails />
            {/* incoming pass, dropping toward the striker's boot */}
            <g className="fi-ball fi-ball--in">
              <Ball />
            </g>
            {/* striker rising to meet it */}
            <g className="fi-striker fi-striker--leap" transform="translate(430 300)">
              <StrikerLeap />
            </g>
          </svg>
        </div>

        {/* ---- ACT 2 · THE STRIKE ---------------------------------------- */}
        <div className="fi-stage fi-act2">
          <svg className="fi-scene" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet">
            {/* the volley — inverted, foot whipping through the ball */}
            <g className="fi-striker fi-striker--volley" transform="translate(470 320)">
              <StrikerVolley />
            </g>
            <g className="fi-impact" transform="translate(560 300)">
              <ImpactBurst />
              <g className="fi-ball fi-ball--struck">
                <Ball />
              </g>
            </g>
          </svg>
        </div>

        {/* ---- ACT 3 · THE FLIGHT & THE KEEPER --------------------------- */}
        <div className="fi-stage fi-act3">
          <svg className="fi-scene" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet">
            <GoalFrame className="fi-goal fi-goal--far" />
            {/* keeper hurling himself across, beaten */}
            <g className="fi-keeper" transform="translate(720 300)">
              <Keeper />
            </g>
            {/* the comet rockets from lower-left toward the top corner */}
            <g className="fi-ball fi-ball--flight">
              <CometTrail />
              <Ball />
            </g>
          </svg>
        </div>

        {/* ---- ACT 4 · THE GOAL ------------------------------------------ */}
        <div className="fi-stage fi-act4">
          <svg className="fi-scene" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet">
            <GoalFrame className="fi-goal fi-goal--hit" hit />
            <g className="fi-ball fi-ball--rest" transform="translate(640 250)">
              <Ball />
            </g>
            <g className="fi-netburst" transform="translate(640 250)">
              <ImpactBurst />
            </g>
          </svg>
          <div className="fi-goal-word">GOAL</div>
        </div>
      </div>

      {/* concentration / grain / vignette that sit above the stages */}
      <div className="fi-vignette" />
      <div className="fi-grain" />

      {/* ACT 5 · the flash-cut mid-sequence and the closing screen-wipe */}
      <div className="fi-flash" />
      <div className="fi-wipe" />

      <button className="fi-skip" type="button" onClick={dismiss} aria-label="Skip intro">
        Skip <span aria-hidden="true">▸</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SVG primitives — bold near-black fills with sharp neon rim-light.   */
/* ------------------------------------------------------------------ */

function Ball() {
  return (
    <g className="fi-ballmark">
      <circle r="26" className="fi-ball-glow" />
      <circle r="17" className="fi-ball-core" />
      <path
        className="fi-ball-seam"
        d="M-9 -13 L0 -17 L9 -13 L13 -3 L6 9 L-6 9 L-13 -3 Z"
      />
    </g>
  );
}

function StrikerLeap() {
  // Rising to meet the pass: torso arched back, lead knee driving up, arms flung wide.
  return (
    <g className="fi-figure">
      <ellipse className="fi-halo" cx="28" cy="10" rx="115" ry="145" />
      <path
        className="fi-fill"
        d="M-40 120 L-18 60 L-30 10 Q-40 -30 -20 -58 L2 -70 Q26 -78 40 -58 L58 -30
           L96 -44 L104 -26 L60 -6 L44 26 L70 70 L52 84 L28 44 L10 66 L22 128 L-2 128
           L-8 70 L-30 96 L-46 84 Z"
      />
      <path className="fi-rim" d="M2 -70 Q26 -78 40 -58 L58 -30 L96 -44" />
      <path className="fi-rim" d="M-30 10 Q-40 -30 -20 -58" />
      <circle className="fi-head" cx="10" cy="-84" r="20" />
      <path className="fi-hair" d="M-8 -92 L-14 -104 L2 -100 L4 -112 L18 -100 L30 -104 L24 -88" />
    </g>
  );
}

function StrikerVolley() {
  // The volley itself — body inverted/whipping, striking leg snapping across the top.
  return (
    <g className="fi-figure">
      <ellipse className="fi-halo" cx="40" cy="-6" rx="135" ry="130" />
      <path
        className="fi-fill"
        d="M-70 40 L-30 20 L4 30 L34 8 L18 -34 Q10 -60 34 -74 L60 -80 Q86 -80 92 -56
           L112 -66 L120 -48 L88 -30 L96 6 L140 -6 L146 14 L92 34 L58 30 L26 64
           L38 96 L14 100 L2 62 L-24 74 L-58 60 Z"
      />
      <path className="fi-rim" d="M34 -74 L60 -80 Q86 -80 92 -56 L112 -66" />
      <path className="fi-rim" d="M96 6 L140 -6" />
      <circle className="fi-head" cx="46" cy="-88" r="19" />
      <path className="fi-hair" d="M30 -96 L24 -110 L40 -104 L44 -116 L58 -102 L70 -108 L62 -90" />
    </g>
  );
}

function Keeper() {
  // Full-stretch dive, fingertips reaching — and beaten.
  return (
    <g className="fi-figure fi-figure--keeper">
      <ellipse className="fi-halo" cx="-30" cy="4" rx="130" ry="85" />
      <path
        className="fi-fill"
        d="M-120 -30 L-84 -20 L-52 -34 L-16 -22 L18 -34 L44 -18 L36 22 Q30 46 4 46
           L-30 40 L-58 12 L-92 4 L-118 -6 Z M-72 12 L-96 40 L-78 52 L-56 30 Z
           M40 -14 L64 8 L52 26 L30 8 Z"
      />
      <path className="fi-rim fi-rim--keeper" d="M-120 -30 L-84 -20 L-52 -34 L-16 -22 L18 -34 L44 -18" />
      <circle className="fi-head fi-head--keeper" cx="-96" cy="-40" r="17" />
    </g>
  );
}

function GoalFrame({ className = "", hit = false }: { className?: string; hit?: boolean }) {
  // Neon post + mesh. On `hit`, the CSS lights the net and ripples the mesh.
  const mesh: React.ReactNode[] = [];
  for (let x = 0; x <= 300; x += 20) mesh.push(<line key={`v${x}`} x1={x} y1="0" x2={x} y2="220" />);
  for (let y = 0; y <= 220; y += 20) mesh.push(<line key={`h${y}`} x1="0" y1={y} x2="300" y2={y} />);
  return (
    <g className={className} transform="translate(500 150)">
      <g className={`fi-net${hit ? " fi-net--hit" : ""}`}>{mesh}</g>
      <path className="fi-post" d="M-14 224 L-14 -14 L314 -14 L314 224" />
    </g>
  );
}

function SpeedTrails() {
  return (
    <g className="fi-trails">
      <path d="M60 200 L360 200" />
      <path d="M40 300 L400 300" />
      <path d="M80 400 L340 400" />
      <path d="M20 250 L300 250" />
      <path d="M100 360 L380 360" />
    </g>
  );
}

function CometTrail() {
  return (
    <path
      className="fi-comet"
      d="M-260 200 Q-120 120 0 0"
    />
  );
}

function ImpactBurst() {
  const shards: React.ReactNode[] = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a);
    const y = Math.sin(a);
    shards.push(
      <line
        key={i}
        x1={x * 14}
        y1={y * 14}
        x2={x * 64}
        y2={y * 64}
        style={{ ["--i" as string]: i }}
      />
    );
  }
  return (
    <g className="fi-burst">
      <circle className="fi-burst-ring" r="20" />
      <circle className="fi-burst-ring fi-burst-ring--2" r="20" />
      <g className="fi-burst-shards">{shards}</g>
    </g>
  );
}
