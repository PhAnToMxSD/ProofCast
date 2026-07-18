"use client";

// The matchday player. Two narration sources:
//  - a pre-generated ElevenLabs mp3 (the quota-guarded Phase 6 asset) — driven
//    through a Web Audio analyser for a real frequency visualizer;
//  - the browser's SpeechSynthesis voice for combinations that have no mp3
//    (site never spends ElevenLabs quota) — energy is simulated per word.
//
// Either way the component reports a 0..1 "energy" upward every frame; the
// scoreboard maps it onto flag scale/glow and the bouncing ball via --energy.

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  audioUrl: string | null;
  text: string;
  styleKey: string;
  onEnergy: (e: number) => void;
};

const TTS_VOICE_TUNING: Record<string, { rate: number; pitch: number }> = {
  hype: { rate: 1.08, pitch: 1.12 },
  analyst: { rate: 0.98, pitch: 0.85 },
  bedtime: { rate: 0.85, pitch: 1.0 },
};
const DEFAULT_TTS_TUNING = { rate: 1.0, pitch: 1.0 };

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer({ audioUrl, text, styleKey, onEnergy }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const energyRef = useRef(0);
  const playingRef = useRef(false);
  const ttsProgressRef = useRef(0); // chars spoken (browser narration)

  const isTts = !audioUrl;
  // Rough browser-narration length estimate so the clock isn't blank.
  const ttsEstimate =
    (text.split(/\s+/).length / (170 * (TTS_VOICE_TUNING[styleKey]?.rate ?? 1))) * 60;

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
      } else if (playingRef.current) {
        // browser narration: pseudo-spectrum shaped by simulated energy
        energyRef.current *= 0.94; // decay between word boundaries
        const e = energyRef.current;
        for (let i = 0; i < BARS; i++) {
          const wave = 0.5 + 0.5 * Math.sin(t * 6 + i * 0.9) * Math.sin(t * 2.3 + i * 0.31);
          heights.push(e * (0.25 + 0.75 * wave));
        }
        energy = e * 0.8;
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
      window.speechSynthesis?.cancel();
      ctxRef.current?.close().catch(() => {});
      onEnergy(0);
    };
  }, [onEnergy]);

  // Chrome quietly stalls long utterances; nudging resume() keeps it talking.
  useEffect(() => {
    if (!isTts || !playing) return;
    const id = setInterval(() => window.speechSynthesis?.resume(), 8000);
    return () => clearInterval(id);
  }, [isTts, playing]);

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

  const toggleTts = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (synth.speaking && !synth.paused) {
      synth.pause();
      setIsPlaying(false);
      return;
    }
    if (synth.paused) {
      synth.resume();
      setIsPlaying(true);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const tune = TTS_VOICE_TUNING[styleKey] ?? DEFAULT_TTS_TUNING;
    u.rate = tune.rate;
    u.pitch = tune.pitch;
    u.onboundary = (ev) => {
      energyRef.current = Math.min(1, 0.55 + Math.random() * 0.4);
      ttsProgressRef.current = ev.charIndex;
      setCurrentTime((ev.charIndex / text.length) * ttsEstimate);
    };
    u.onend = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      ttsProgressRef.current = 0;
    };
    u.onerror = () => setIsPlaying(false);
    synth.cancel();
    synth.speak(u);
    setIsPlaying(true);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const shownDuration = isTts ? ttsEstimate : duration;
  const shownProgress = isTts
    ? (ttsProgressRef.current / Math.max(1, text.length)) * 100
    : progress;

  return (
    <div className="player">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
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
          onClick={isTts ? toggleTts : toggleMp3}
          aria-label={playing ? "Pause narration" : "Play narration"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="track">
          <div className="titles">
            <span className="who">
              {isTts ? "Browser voice narration" : "ElevenLabs narration"}
            </span>
            <span className="time">
              {fmt(currentTime)} / {isTts ? "~" : ""}
              {fmt(shownDuration)}
            </span>
          </div>
          <input
            className="seek"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={Math.min(100, shownProgress)}
            disabled={isTts}
            style={{ "--progress": `${shownProgress}%` } as React.CSSProperties}
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
      {isTts && (
        <div className="source-note">
          No pre-generated ElevenLabs audio for this combination — narrated by your
          browser to protect the TTS quota.
        </div>
      )}
    </div>
  );
}
