// Phase 7 — on-demand ElevenLabs narration: POST /api/audio.
//
// The website now generates studio audio itself (no browser-voice fallback).
// Given a transcript, this route reads the LIVE remaining quota, refuses to
// start if there aren't enough characters left, synthesizes the mp3 server-side
// (the ElevenLabs key never reaches the browser), and persists it to both
// cache/audio (repo-canonical) and public/audio (served statically). A repeat
// request for text that's already been narrated returns the existing file and
// spends nothing.
//
// Quota exhaustion — before OR during synthesis — returns HTTP 402 with
// { error, creditsEnded: true } so the UI can say the credits have run out.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import data from "@/lib/generated/data.json";
import { getQuota, synthesize, charCost, voiceForStyle } from "@/lib/pipeline/tts";

export const runtime = "nodejs";
export const maxDuration = 120; // ElevenLabs synthesis of a full recap can be slow

const RequestSchema = z.object({
  matchId: z.string().regex(/^\d+$/),
  style: z.enum(["hype", "analyst", "bedtime"]),
  text: z.string().min(1).max(5000),
});

// public/audio is served at /audio/*; cache/audio is the repo-canonical copy the
// sync script re-embeds on the next build. Resolve both from the web/ cwd.
const PUBLIC_AUDIO = path.join(process.cwd(), "public", "audio");
const CACHE_AUDIO = path.join(process.cwd(), "..", "cache", "audio");

function creditsEnded(message: string) {
  return NextResponse.json({ error: message, creditsEnded: true }, { status: 402 });
}

// Neutral presets keep their clean stem so they line up with the committed
// pipeline output; anything else (personalized/live text) gets a content hash
// so distinct transcripts never overwrite each other's audio.
function stemFor(matchId: string, style: string, text: string): string {
  const base = `${matchId}-${style}`;
  const preset = (data.recaps as Record<string, { text?: string }>)[base]?.text;
  if (preset && preset.trim() === text.trim()) return base;
  const hash = createHash("sha1").update(text).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

export async function POST(req: Request) {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.errors[0]?.message : "invalid JSON body" },
      { status: 400 }
    );
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { error: "ElevenLabs is not configured on this deployment (ELEVENLABS_API_KEY missing)." },
      { status: 503 }
    );
  }

  const stem = stemFor(body.matchId, body.style, body.text);
  const audioUrl = `/audio/${stem}.mp3`;

  // Already narrated — hand it back, spend nothing.
  const publicPath = path.join(PUBLIC_AUDIO, `${stem}.mp3`);
  if (fs.existsSync(publicPath)) {
    return NextResponse.json({ audioUrl, source: "cache", chars: 0 });
  }

  const chars = charCost(body.text);

  // Pre-flight quota gate — refuse before spending anything if we can't finish.
  try {
    const quota = await getQuota();
    if (quota.remaining < chars) {
      return creditsEnded(
        `Not enough ElevenLabs credits: this narration needs ${chars} characters but only ` +
          `${quota.remaining} remain. No audio was generated.`
      );
    }
  } catch {
    // Quota read failed for a non-permission reason — proceed and let the
    // synthesis itself surface any hard quota error below.
  }

  // Synthesize. No retries: a failed call may still have burned characters.
  let mp3: Buffer;
  try {
    mp3 = await synthesize(body.text, voiceForStyle(body.style));
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = decodeError(err?.response?.data);
    // 401 quota_exceeded / 429 too-many-requests both mean "out of credits".
    if (status === 429 || /quota|credit/i.test(detail)) {
      return creditsEnded(
        "ElevenLabs credits have run out — the monthly character quota is exhausted. " +
          "No audio was generated."
      );
    }
    return NextResponse.json(
      { error: `audio generation failed: ${detail || err?.message || "unknown error"}` },
      { status: 502 }
    );
  }

  // Persist to both the served dir and the repo-canonical cache. This is
  // best-effort: locally it commits the canonical mp3 so the next build embeds
  // it, but on a serverless host (Vercel) the filesystem is read-only, so a
  // write failure must NOT lose the audio we just paid to synthesize. When we
  // can't write a served file, hand the bytes back inline as a data: URL — the
  // <audio> element and the visualizer's MediaElementSource both play it.
  try {
    fs.mkdirSync(PUBLIC_AUDIO, { recursive: true });
    fs.mkdirSync(CACHE_AUDIO, { recursive: true });
    fs.writeFileSync(publicPath, mp3);
    fs.writeFileSync(path.join(CACHE_AUDIO, `${stem}.mp3`), mp3);
  } catch {
    const dataUrl = `data:audio/mpeg;base64,${mp3.toString("base64")}`;
    return NextResponse.json({ audioUrl: dataUrl, source: "generated", chars });
  }

  return NextResponse.json({ audioUrl, source: "generated", chars });
}

// ElevenLabs error bodies arrive as an arraybuffer (synthesize requests binary).
// Decode to a searchable string so we can classify quota failures.
function decodeError(raw: unknown): string {
  if (!raw) return "";
  try {
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
    if (Buffer.isBuffer(raw)) return raw.toString("utf8");
    if (typeof raw === "string") return raw;
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}
