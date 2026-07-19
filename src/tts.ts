// Phase 6 — ElevenLabs text-to-speech client. QUOTA-CRITICAL.
//
// Free tier = 10,000 characters/month TOTAL across the whole account. This is
// the scarcest resource in the project. Every helper here is built around not
// wasting it: we read the LIVE remaining quota from ElevenLabs before ever
// synthesizing, we never retry a synthesis on failure (a failed call may still
// have burned characters), and callers gate every synthesis behind an explicit
// human confirmation. See scripts/05-generate-audio.ts for the guardrails.

import axios from "axios";
import "dotenv/config";
import type { StyleKey } from "./styles.js";

const API_BASE = "https://api.elevenlabs.io/v1";

export function hasApiKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set (Phase 6 prerequisite).");
  return key;
}

// ── Voice mapping (stock ElevenLabs voices — no cloning on free tier) ─────────
// Voice IDs are the stable public defaults from the ElevenLabs voice library,
// chosen to match each persona's voiceHint in src/styles.ts. Audition/swap these
// in the ElevenLabs web UI (NOT via the API — auditioning there costs no quota),
// then paste the id here or pass --voice on the CLI.
export type VoiceProfile = {
  voiceId: string;
  name: string;
  // Expressiveness knobs. Lower stability = more dynamic/emotional delivery.
  stability: number;
  similarityBoost: number;
};

// All three are ElevenLabs PREMADE default voices — the only category the free
// tier can use via the API. Library-only voices (e.g. Antoni/Rachel) return
// `paid_plan_required`. Audition/swap these in the ElevenLabs web UI, then paste
// the id here or pass --voice on the CLI.
export const VOICES: Record<StyleKey, VoiceProfile> = {
  // energetic, excitable male sports commentator (Charlie — "Deep, Confident, Energetic")
  hype: { voiceId: "IKne3meq5aSn9XLyUdCD", name: "Charlie", stability: 0.3, similarityBoost: 0.75 },
  // measured, dry, articulate analyst (Daniel — "Steady Broadcaster", British)
  analyst: { voiceId: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", stability: 0.6, similarityBoost: 0.75 },
  // soft, warm, slow female storyteller (Lily — "Velvety Actress", British)
  bedtime: { voiceId: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", stability: 0.75, similarityBoost: 0.75 },
};

// Highest-quality stock model. Billing is per INPUT character regardless of the
// model chosen, so there is no quota advantage to a cheaper model here.
const MODEL_ID = "eleven_multilingual_v2";

export type Quota = {
  used: number; // characters consumed this billing period
  limit: number; // characters allowed this billing period
  remaining: number;
  estimated: boolean; // true when read from the local log, not ElevenLabs
};

// Free-tier monthly allowance, used only for the local-estimate fallback.
export const FREE_TIER_LIMIT = 10_000;

/**
 * Read the remaining character quota. Prefers the LIVE figure from ElevenLabs
 * (costs no quota). If the API key is scoped without `user_read` permission
 * (a 401/403 on the subscription endpoint), fall back to estimating from a
 * caller-supplied count of already-logged spend against the free-tier limit.
 * The `estimated` flag tells the caller which path was taken.
 */
export async function getQuota(loggedSpend = 0): Promise<Quota> {
  try {
    const res = await axios.get(`${API_BASE}/user/subscription`, {
      headers: { "xi-api-key": apiKey() },
      timeout: 30_000,
    });
    const used = Number(res.data?.character_count ?? 0);
    const limit = Number(res.data?.character_limit ?? 0);
    return { used, limit, remaining: Math.max(0, limit - used), estimated: false };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      // Scoped key without user_read — estimate locally instead of failing.
      return {
        used: loggedSpend,
        limit: FREE_TIER_LIMIT,
        remaining: Math.max(0, FREE_TIER_LIMIT - loggedSpend),
        estimated: true,
      };
    }
    throw err;
  }
}

/** The exact characters ElevenLabs will bill for this text. */
export function charCost(text: string): number {
  return text.length;
}

/**
 * Synthesize `text` to MP3 bytes with the given voice. Returns the audio buffer.
 *
 * IMPORTANT: no retries. A failed request may still have consumed quota, so the
 * caller must treat any throw as "characters possibly spent, do not re-call
 * blindly". The quota guard lives in the CLI, not here.
 */
export async function synthesize(
  text: string,
  voice: VoiceProfile
): Promise<Buffer> {
  const res = await axios.post(
    `${API_BASE}/text-to-speech/${voice.voiceId}`,
    {
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: voice.stability,
        similarity_boost: voice.similarityBoost,
      },
    },
    {
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
      timeout: 120_000,
    }
  );
  return Buffer.from(res.data);
}

export function voiceForStyle(style: StyleKey, override?: string): VoiceProfile {
  const base = VOICES[style] ?? VOICES.analyst;
  return override ? { ...base, voiceId: override, name: `override(${override.slice(0, 6)}…)` } : base;
}
