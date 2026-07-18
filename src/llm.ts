// Phase 5 — OpenRouter chat client (OpenAI-compatible).
//
// A specific :free model is pinned (NOT `openrouter/free`, which rotates models
// per call and would make demo output drift). A FALLBACK is kept in case the
// primary is delisted or rate-limited before the demo.

import axios from "axios";
import "dotenv/config";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// ── Pinned models (auditioned against the live :free list on 2026-07-18) ──────
// gemma-4-31b served reliably; llama-3.3-70b was persistently saturated upstream
// that day, so it's the fallback. Override per call with --model.
export const PRIMARY_MODEL = "google/gemma-4-31b-it:free";
export const FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

// The free :free endpoints saturate intermittently, so we rotate across an
// ordered list of good free writers (best first) and take the first that serves
// valid content. The chosen model is recorded per recap. Pass --model to force one.
// Instruct writers only — reasoning models (nemotron, gpt-oss) leak their
// chain-of-thought into the output, so they are deliberately excluded.
export const CANDIDATE_MODELS = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-26b-a4b-it:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
];

// Bounded, polite retry for transient upstream saturation (NOT an account cap).
const MAX_UPSTREAM_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export class QuotaError extends Error {}
export class ModelError extends Error {}

async function callOnce(
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set (Phase 5 prerequisite).");

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await axios.post(
        ENDPOINT,
        {
          model,
          messages,
          temperature: opts.temperature ?? 0.8,
          max_tokens: opts.maxTokens ?? 900,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            // Recommended by OpenRouter for attribution / ranking.
            "HTTP-Referer": "https://github.com/PhAnToMxSD/ProofCast",
            "X-Title": "ProofCast",
          },
          timeout: 90_000,
        }
      );
      const text: string | undefined = res.data?.choices?.[0]?.message?.content;
      if (!text || !text.trim()) throw new ModelError(`${model} returned empty content`);
      return text.trim();
    } catch (err: any) {
      if (err instanceof ModelError) throw err;
      const status = err?.response?.status;
      const raw = JSON.stringify(err?.response?.data ?? "");
      const isUpstream = /upstream|Provider returned error/i.test(raw);

      if (status === 429 && isUpstream && attempt <= MAX_UPSTREAM_RETRIES) {
        await sleep(3000 * attempt); // linear backoff: 3s, 6s, 9s, …
        continue;
      }
      if (status === 429) {
        throw new QuotaError(
          isUpstream
            ? `${model} is saturated upstream — still 429 after ${MAX_UPSTREAM_RETRIES} retries.`
            : `Account rate limit (429) on ${model}. Free tier: 20 req/min, 50 req/day.`
        );
      }
      const detail = err?.response?.data?.error?.message ?? err?.message ?? String(err);
      throw new ModelError(`${model} failed: ${detail}`);
    }
  }
}

export type GenerationResult = { text: string; model: string };

/**
 * Generate by rotating across CANDIDATE_MODELS (best writer first), returning the
 * first that serves valid content. If --model is given, only that model is used
 * (with its own upstream retries) so demo output stays on a single pinned model.
 */
export async function generate(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<GenerationResult> {
  const chain = opts.model ? [opts.model] : CANDIDATE_MODELS;
  let lastErr: Error | undefined;
  for (const model of chain) {
    try {
      return { text: await callOnce(model, messages, opts), model };
    } catch (err) {
      lastErr = err as Error;
      if (chain.length > 1) console.warn(`  · ${model} unavailable (${lastErr.message}); rotating…`);
    }
  }
  throw lastErr ?? new Error("no candidate model available");
}
