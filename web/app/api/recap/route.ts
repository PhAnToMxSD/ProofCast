// Phase 7 backend — the single serverless route: POST /api/recap.
//
// Cached-first: preset styles with no personalization are served straight from
// the committed pipeline outputs (instant, zero API spend). A favourite-team
// personalization runs the real Phase 5 pipeline live, server-side — the
// OpenRouter key never reaches the browser. Audio is only ever the pre-generated
// ElevenLabs mp3 (quota rule: no TTS spend from the website); uncached
// combinations fall back to browser narration client-side.

import { NextResponse } from "next/server";
import { z } from "zod";
import data from "@/lib/generated/data.json";
import { MatchBriefSchema } from "@/lib/pipeline/types";
import { generateRecap, type Recap } from "@/lib/pipeline/recap";

export const runtime = "nodejs";
export const maxDuration = 60; // live path rotates free models; give it room

const RequestSchema = z.object({
  matchId: z.string().regex(/^\d+$/),
  style: z.enum(["hype", "analyst", "bedtime"]),
  favouriteTeam: z.string().min(1).max(60).optional(),
});

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

  const rawBrief = (data.briefs as Record<string, unknown>)[body.matchId];
  if (!rawBrief) {
    return NextResponse.json({ error: `unknown match ${body.matchId}` }, { status: 404 });
  }

  const stem = `${body.matchId}-${body.style}`;
  const audioUrl = (data.audio as Record<string, string>)[stem] ?? null;

  // Cached path — presets with no personalization.
  if (!body.favouriteTeam) {
    const cached = (data.recaps as Record<string, unknown>)[stem] as Recap | undefined;
    if (cached) {
      return NextResponse.json({ recap: cached, audioUrl, source: "cache" });
    }
  }

  // Live path — the real Phase 5 pipeline, key stays server-side.
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Live generation is not configured on this deployment (OPENROUTER_API_KEY missing). " +
          "The cached preset recaps still work.",
      },
      { status: 503 }
    );
  }

  try {
    const brief = MatchBriefSchema.parse(rawBrief);
    const recap = await generateRecap(brief, body.style, {
      favouriteTeam: body.favouriteTeam,
    });
    // Pre-generated audio never matches a personalized text — narration falls
    // back to the browser for live output.
    return NextResponse.json({ recap, audioUrl: null, source: "live" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `live generation failed: ${message}` }, { status: 502 });
  }
}
