"use client";

// The matchday player. Narration is always a real ElevenLabs mp3 — there is no
// browser-voice fallback. When a combination has no pre-generated audio yet, the
// player offers a "Generate studio audio" button that synthesizes it on demand
// via /api/audio (quota-guarded, key stays server-side). If the account's
// ElevenLabs credits are exhausted, the button surfaces a credits-ended error.
//
// While an mp3 plays it is driven through a Web Audio analyser for a real
// frequency visualizer, and the component reports a 0..1 "energy" upward every
// frame; the scoreboard maps it onto flag scale/glow and the bouncing ball.

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  matchId: string;
  audioUrl: string | null;
  text: string;
  styleKey: string;
  onEnergy: (e: number) => void;
};

type GenError = { message: string; creditsEnded: boolean };

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer({ matchId, audioUrl, text, styleKey, onEnergy }: Props) {
  const [url, setUrl] = useState<string | null>(audioUrl);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<GenError | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const playingRef = useRef(false);

  // Keep local url in sync if the parent hands us a different recap/style.
  useEffect(() => {
    setUrl(audioUrl);
    setGenError(null);
  }, [audioUrl]);

  // ── analyser wiring (mp3 mode) ─────────────────────────────────────────
  const ensureAnalyser = useCallback(() => {
    const el = audioRef.current;
    if (!el || ctxRef.current) return;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  // ── render loop: visualizer bars + energy reporting ────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.round(64 * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const freq = new Uint8Array(128);
    const BARS = 40;
    let t = 0;

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      t += 0.016;
      const W = canvas.width;
      const H = canvas.height;
      g.clearRect(0, 0, W, H);

      const analyser = analyserRef.current;
      let energy = 0;
      const heights: number[] = [];

      if (analyser && playingRef.current) {
        analyser.getByteFrequencyData(freq);
        let sum = 0;
        for (let i = 0; i < BARS; i++) {
          // sample low→mid bins; that's where commentary voices live
          const v = freq[Math.floor((i / BARS) * 64)] / 255;
          heights.push(v);
          sum += v;
        }
        energy = Math.min(1, (sum / BARS) * 1.6);
      } else {
        // idle: a gentle crowd wave
        for (let i = 0; i < BARS; i++) {
          heights.push(0.05 + 0.04 * Math.sin(t * 1.4 + i * 0.55));
        }
      }

      onEnergy(energy);

      const gap = W / BARS;
      const bw = Math.max(2 * dpr, gap * 0.55);
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(2 * dpr, heights[i] * H * 0.92);
        const x = i * gap + (gap - bw) / 2;
        const grad = g.createLinearGradient(0, H, 0, H - h);
        grad.addColorStop(0, "rgba(25, 195, 125, 0.85)");
        grad.addColorStop(1, "rgba(63, 240, 162, 0.95)");
        g.fillStyle = grad;
        g.beginPath();
        if (typeof g.roundRect === "function") g.roundRect(x, H - h, bw, h, bw / 2);
        else g.rect(x, H - h, bw, h);
        g.fill();
      }
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [onEnergy]);

  // ── teardown ───────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      onEnergy(0);
    };
  }, [onEnergy]);

  const setIsPlaying = (v: boolean) => {
    playingRef.current = v;
    setPlaying(v);
  };

  // ── controls ───────────────────────────────────────────────────────────
  const toggleMp3 = () => {
    const el = audioRef.current;
    if (!el) return;
    ensureAnalyser();
    ctxRef.current?.resume();
    if (el.paused) void el.play();
    else el.pause();
  };

  const generate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, style: styleKey, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError({
          message: data.error ?? `generation failed (${res.status})`,
          creditsEnded: Boolean(data.creditsEnded),
        });
        return;
      }
      setUrl(data.audioUrl as string);
    } catch (err) {
      setGenError({
        message: err instanceof Error ? err.message : String(err),
        creditsEnded: false,
      });
    } finally {
      setGenerating(false);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          crossOrigin="anonymous"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}
      <div className="row">
        <button
          className={`play-btn ${playing ? "playing" : ""}`}
          onClick={toggleMp3}
          disabled={!url}
          aria-label={playing ? "Pause narration" : "Play narration"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="track">
          <div className="titles">
            <span className="who">ElevenLabs narration</span>
            <span className="time">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>
          <input
            className="seek"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={Math.min(100, progress)}
            disabled={!url}
            style={{ "--progress": `${progress}%` } as React.CSSProperties}
            onChange={(e) => {
              const el = audioRef.current;
              if (!el || !duration) return;
              el.currentTime = (Number(e.target.value) / 100) * duration;
            }}
            aria-label="Seek"
          />
        </div>
      </div>
      <canvas ref={canvasRef} className="visualizer" aria-hidden="true" />

      {!url && (
        <div className="gen-audio">
          <button className="gen-btn" onClick={generate} disabled={generating}>
            {generating ? (
              <>
                <span className="spin" aria-hidden="true">◜</span> Synthesizing with ElevenLabs…
              </>
            ) : (
              <>🎧 Generate studio audio</>
            )}
          </button>
          <span className="gen-note">
            {generating
              ? "Calling ElevenLabs — this uses your monthly character quota."
              : "No studio narration yet for this take. Generate it with ElevenLabs (spends TTS quota)."}
          </span>
        </div>
      )}

      {genError && (
        <div className={`gen-error ${genError.creditsEnded ? "credits" : ""}`} role="alert">
          {genError.creditsEnded ? (
            <>
              <strong>🚫 ElevenLabs credits have ended.</strong> {genError.message}
            </>
          ) : (
            <>
              <strong>Audio generation failed.</strong> {genError.message}
            </>
          )}
        </div>
      )}
    </div>
  );
}
