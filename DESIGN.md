# AI Match Storyteller — Implementation Plan

**Project:** Post-match AI commentary recaps generated from cryptographically verified TxLINE match data, narrated as audio, with on-chain "verify this moment" proof links.

**Hackathon:** TxODDS World Cup Hackathon — *Consumer & Fan Experiences* track ($16K), on Superteam Earn.
**Deadline:** Submissions close **19 July 2026**. Winners announced 29 July 2026.
**Qualifying bar:** Must be a *functional build or live testnet application using TxLINE data as a primary input.*

---

## 0. Guiding constraints (read before writing any code)

1. **Terminal-first.** Every phase must be runnable as a standalone CLI script and verified before moving on. The website is the LAST step, and only wraps an already-working pipeline.
2. **Devnet only.** Never touch mainnet. Devnet SOL from a faucet, free World Cup tier, no TxL purchase.
3. **Time is the binding constraint, not cost.** Prefer the boring option that finishes.
4. **ElevenLabs free tier = 10,000 characters/month total.** This is the scarcest resource in the whole project. NEVER call TTS during iteration. Text pipeline gets tested freely; TTS gets called only on text we've already approved. Budget: ~1,500–2,500 chars per recap → only ~4–6 generations exist for the entire month.
5. **Cache everything to disk.** Raw TxLINE responses, match briefs, generated text, and audio. Re-running a script must never re-hit a paid/limited API for data already fetched.
6. **No fabricated facts.** The LLM only ever sees a structured brief we built from verified data. If it isn't in the brief, it must not appear in the recap.
7. **Secrets in `.env` only.** Never commit keys. Never ship keys to the frontend.

---

## 1. Prerequisites the human must supply

Claude Code should check for these at the start and stop with a clear message if any are missing.

| Item | Where to get it | Env var |
|---|---|---|
| Solana devnet keypair | `solana-keygen new` (or generate in-script) | `SOLANA_KEYPAIR_PATH` |
| Devnet SOL | `solana airdrop 2 --url devnet` or web faucet | — |
| OpenRouter API key | openrouter.ai (email/GitHub signup, no card) | `OPENROUTER_API_KEY` |
| ElevenLabs API key | elevenlabs.io free tier | `ELEVENLABS_API_KEY` |

No TxLINE key is issued up-front — it is *earned* via the on-chain subscribe + activate flow in Phase 2.

---

## 2. Phase 0 — Scaffold (target: 20 min)

```
/ai-match-storyteller
  /scripts          # CLI entry points, run in order
    01-auth.ts
    02-fetch-match.ts
    03-build-brief.ts
    04-generate-text.ts
    05-generate-audio.ts
    06-run-all.ts
  /src
    txline.ts       # auth + data client
    brief.ts        # raw feed -> structured MatchBrief
    styles.ts       # commentary persona prompts
    llm.ts          # OpenRouter client
    tts.ts          # ElevenLabs client
    types.ts
  /cache
    /raw            # raw TxLINE responses (gitignored)
    /briefs         # structured JSON briefs (COMMITTED - demo fallback)
    /recaps         # generated text (COMMITTED - demo fallback)
    /audio          # generated mp3 (COMMITTED - demo fallback)
  /web              # Phase 7 ONLY - do not start early
  .env.example
  .gitignore
  README.md
```

**Stack:** Node.js + TypeScript, `tsx` for running scripts directly. Deps: `@solana/web3.js`, `@coral-xyz/anchor`, `@solana/spl-token`, `axios`, `tweetnacl`, `dotenv`, `zod` (brief validation).

**Checkpoint:** `npx tsx scripts/01-auth.ts --help` runs without crashing.

---

## 3. Phase 1 — Read the docs first (target: 20 min)

**Do not write the TxLINE client from memory or from this plan's snippets alone.** The API shapes below are indicative; the docs are authoritative.

1. Fetch `https://txline-docs.txodds.com/llms.txt` — this is the LLM-friendly documentation index.
2. From it, read at minimum:
   - Quickstart (auth, subscribe, activate)
   - **World Cup Free Tier** page (service levels 1 or 12 — which one we need)
   - **Runnable Devnet Examples** (they ship working free-tier activation + fixture/scores scripts — *copy these, don't reinvent*)
   - API Reference: fixtures, scores, odds endpoints + response shapes
   - Troubleshooting
3. Write down in `README.md`: the exact endpoints, the service level ID we're using, and the response field names for scores/events/odds.

**Checkpoint:** README documents the real endpoint list and the exact shape of a completed-match response.

---

## 4. Phase 2 — TxLINE access (target: 60–90 min) ⚠️ HIGHEST RISK

This phase is the most likely to eat the day. Timebox it. If blocked >90 min, ask for help in the TxODDS Telegram (`t.me/TxLINEChat`) immediately rather than grinding.

**Devnet config (from quickstart):**
- RPC: `https://api.devnet.solana.com`
- Program ID: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Guest auth: `https://txline-dev.txodds.com/auth/guest/start`
- API base: `https://txline-dev.txodds.com/api/`
- **Rule: RPC, program ID, guest JWT host and API host must ALL be devnet. Never mix.**

**Service level (confirmed against docs — devnet):** `SERVICE_LEVEL_ID = 1` ("World Cup & Int Friendlies"; `samplingIntervalSec = 0` on devnet). `SELECTED_LEAGUES = []`. `DURATION_WEEKS` in multiples of 4 → use `4`. (Level `12`/real-time is mainnet-only; we are devnet-only.)

**`scripts/01-auth.ts` steps:**
1. Load devnet keypair; assert SOL balance > 0 (airdrop if not). SOL covers tx fees + account rent; no TxL token purchase needed.
2. `subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)` on-chain via Anchor, `SELECTED_LEAGUES = []` for the standard free bundle. Capture `txSig`.
3. `POST /auth/guest/start` → guest JWT (`TokenResponse`). **The JWT is valid for 30 days** — it is *not* short-lived, so no per-call refresh is needed (keep a single 401-retry only as a safety net).
4. Sign the activation preimage. **Exact preimage:** `` `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}` `` — with empty leagues this is `${txSig}::${jwt}` (two colons). Signature must be **base64 detached** (ed25519), signed by the SAME wallet that subscribed.
5. `POST /api/token/activate` with `Authorization: Bearer <jwt>` and the JSON body below → API token returned as `text/plain` (e.g. `txoracle_api_…`).
6. Persist token + subscription state to `cache/` so we never re-subscribe.

**Activation request body (`ActivationPayload`) — exact field names:**
```jsonc
{
  "txSig": "<subscribe tx signature>",           // required
  "walletSignature": "<base64 detached sig of the preimage>",  // required — field is `walletSignature`, not `signature`
  "leagues": []                                   // int32[]; empty = standard free bundle
}
```

**Credential rules for the client (`src/txline.ts`):**
- Data requests send BOTH: `Authorization: Bearer <jwt>` and `X-Api-Token: <apiToken>`.
- On `401` → guest JWT invalid/expired → refresh JWT from the same host, retry once with the same API token. (Rare — JWT lasts 30 days.)
- On `403` at activation → check preimage format, wallet identity, base64 signature encoding, network match.

**Checkpoint:** A script prints a live API token and successfully makes one authenticated data call.

---

## 5. Phase 3 — Fetch a completed match (target: 45 min)

`scripts/02-fetch-match.ts --match <id>`

1. List fixtures via `GET /api/fixtures/snapshot`. The fixture object carries no score/status — infer **completed** matches from the scores feed (final `statusSoccerId` = `END`/`FET`, `scoreSoccer.*.Total` populated). Target World Cup / International Friendlies (free tier coverage).
2. Pull for one match via `GET /api/scores/snapshot/{fixtureId}` → `Scores[]`, an ordered array of per-action records. Extract: final score (`scoreSoccer.Participant1/2.Total.Goals`), full event timeline (each record's `dataSoccer.Minutes`, `PlayerId`, and `Goal`/`Penalty`/`YellowCard`/`RedCard`/`VAR`/sub booleans), stats, and odds movement (`GET /api/odds/snapshot/{fixtureId}`).
3. **Critically: capture the proof coordinates for each event.** ⚠️ There is **no per-event `txSig` in the payload** — verification is a Merkle-proof scheme. For every event record, capture its **`fixtureId` + `seq` + relevant `statKey`** (e.g. `1`/`2` = goals) and its `ts` (on-chain-anchored timestamp). Those three are what later fetch a Merkle proof from `GET /api/scores/stat-validation` and drive the on-chain `validateStatV2` call. Without `seq`, a moment cannot be proven later.
4. Dump raw JSON to `cache/raw/<matchId>.json`. Never re-fetch if cached (unless `--force`).

**Checkpoint:** 3–5 completed matches cached as raw JSON, each event record carrying `fixtureId` + `seq` + `statKey` so it can be proven on-chain.

**Verification model (confirmed):** daily Merkle roots are published on-chain in program PDAs (`daily_scores_roots` + epochDay). `stat-validation` returns `mainTreeProof`/`subTreeProof`/`statProof`; submitting `validateStat`/`validateStatV2` on-chain produces the **validation tx signature** that is our per-event receipt. Copy `subscription_scores_*.ts` from the devnet examples. If a per-event proof ever fails, degrade to a per-match proof — but never ship without *something* verifiable.

---

## 6. Phase 4 — Build the structured brief (target: 45 min)

`scripts/03-build-brief.ts --match <id>`

This is the anti-hallucination layer. Raw feed → tight, clean `MatchBrief` JSON. Validate with `zod`.

```ts
type MatchBrief = {
  matchId: string;
  competition: string;
  date: string;
  homeTeam: string; awayTeam: string;
  finalScore: { home: number; away: number };
  events: Array<{
    id: string;              // stable ID the LLM will cite
    minute?: number;         // real match minute from the record Clock (floor(sec/60)+1); on-chain-anchored
    type: "goal" | "own_goal" | "penalty" | "yellow" | "red" | "sub" | "var";
    team: string;
    scorer?: string;         // web2-attributed name (see Phase 4.5); NOT from the chain
    nameSource?: string;     // provenance of `scorer`, e.g. "FIFA / ESPN"
    detail?: string;
    // Proof coordinates — there is NO per-event txSig in the feed. These fetch a
    // Merkle proof (stat-validation) and drive validateStatV2; the resulting on-chain
    // validation tx is the receipt. explorerUrl is filled in once we run that tx.
    proof: { fixtureId: number; seq: number; statKey: number; timestamp?: number; validationTxSig?: string; explorerUrl?: string };
  }>;
  oddsTimeline: Array<{ minute: number; homeWin: number; draw: number; awayWin: number }>;
  oddsHighlights: Array<{ minute: number; description: string; swing: number }>; // computed: biggest market moves
  stats?: Record<string, { home: number | string; away: number | string }>;
};
```

**Derive `oddsHighlights` ourselves** (largest deltas in win probability, and what event they coincide with). This gives the commentary its best material — "the market swung 22 points the second that red card landed" — and it comes from data, not invention.

Keep the brief under ~1,500 tokens. Write to `cache/briefs/<matchId>.json` (committed to git — this is our demo fallback).

**Checkpoint:** Briefs exist for all cached matches and read cleanly to a human.

---

## 6.5. Phase 4.5 — Player names & minutes (web2 enrichment, TxLINE-verified)

*Added after the first end-to-end pass revealed the recaps read flat — "France scored, France
scored" — with no scorers and no minutes. The devnet World Cup fixtures turned out to be **real**
2026 World Cup matches (verified: Norway 1–4 France, Portugal 5–0 Uzbekistan), so real match reports
exist to draw names from. Implemented for Norway–France first.*

**Two facts, two trust tiers — never blurred:**
- **Minute, team, and that-a-goal-happened** are on-chain-verified. The minute is derived from the
  score record's running match `Clock`: `minute = floor(Clock.Seconds/60)+1`. It rides on the same
  record whose `Seq`/`Stats` we already prove, and reproduces the officially announced minute exactly.
  (This restores the `minute` the original plan wanted — the feed does carry it, just in `Clock`, not
  `Data.Minutes`.) Extracted in `src/fetch.ts`.
- **The scorer's name** is *not* in the feed. It comes from a public match report (FIFA/ESPN),
  authored once into a committed `cache/scorers/<matchId>.json`, and is tagged with its `nameSource`.

**Composition (`src/scorers.ts`, run inside `03-build-brief`, offline — no API):** align each named
goal to a verified goal event by **(team, goal order)** — the *k*-th verified goal for a team is
credited to the *k*-th scorer listed for that team. The minute is a **±2 cross-check only**, never the
alignment key, so a report that's a minute off can't misattribute a goal. `composeScorers` **throws**
if the report's per-team goal count disagrees with the chain (a real integrity signal). Own goals /
penalties carry a flag; card-taker names stay unavailable (refer to the team).

**Grounding stays honest:** the brief's `dataNotes` now say, per match, that the LLM may state a
minute / name a scorer **only** for an event that carries one — never invent. The website receipts
label each goal *"🔒 goal, team & minute verified on-chain · scorer name via <source>."* A name is
either sourced or absent; nothing is fabricated.

**To enrich a match:** author `cache/scorers/<id>.json` → `npm run fetch -- --match <id> --force`
→ `npm run brief -- --match <id>` → `npm run text -- --match <id> --all-styles --force` →
(optional) `npm run audio -- --match <id> --style <s> --force --confirm` → `cd web && npm run sync`.

**Checkpoint:** Norway–France recaps name Dembélé's 7'/20'/32' hat-trick, Aasgaard's 21', and Doué's
90+4', each goal still resolving to its on-chain Merkle proof.

---

## 7. Phase 5 — Generate commentary text (target: 60 min)

`scripts/04-generate-text.ts --match <id> --style <style>`

**Model selection (do this first, it takes 10 min and de-risks the demo):**
- OpenRouter, OpenAI-compatible: `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer $OPENROUTER_API_KEY`.
- **Pin ONE specific `:free` model ID. Do NOT use `openrouter/free`** — it randomly rotates models per call, so output style would vary between the pre-generated recaps and the live demo. That's unacceptable for a demo.
- Check the live free-model list on openrouter.ai (filtered to free) **today** — the lineup rotates without notice. Shortlist 2–3 candidates, run the same brief + style through each, pick the best writer.
- Free tier limits: 20 req/min, 50 req/day unfunded. Plenty. Handle `429` with a clear error, not a silent retry storm.
- Hardcode a `FALLBACK_MODEL` constant in case the primary is delisted before the demo.

**Styles (`src/styles.ts`)** — ship at least 3, they're just system prompts:
- `hype` — Hype Hometown Commentator: explosive, partisan, big goal reactions.
- `analyst` — Deadpan Stats Nerd: dry, odds-and-numbers obsessed, understated.
- `bedtime` — Bedtime Story: narrates the match as a gentle fairy tale.
- *(stretch)* `rival` — cocky trash-talk from the opposing side.

**Prompt structure:**
- **System:** the persona + hard rules: *Use ONLY facts present in the supplied JSON. Never invent players, minutes, or scores. Target 300–400 words. After each factual claim, cite the event id in square brackets like [ev_12].*
- **User:** the `MatchBrief` JSON + target style + optional favourite team for personalization.
- **Post-process:** parse out `[ev_xx]` citations → map to the event's proof link → store as structured `{ text, citations[] }`, so the website can render "verify" links inline. Strip the raw tags from the display text.
- **Validate before accepting:** assert the final score stated in the text matches the brief; assert every cited event ID actually exists. Fail loudly if not — this check is what makes the "grounded, verifiable AI" claim honest rather than marketing.

Write to `cache/recaps/<matchId>-<style>.json` (committed).

**Checkpoint:** 3 matches × 3 styles of text recaps, all passing validation, all reading well. **Zero TTS calls made so far.**

---

## 8. Phase 6 — Generate audio (target: 30 min) ⚠️ QUOTA-CRITICAL

`scripts/05-generate-audio.ts --match <id> --style <style>`

**Before any call, the script MUST:**
1. Print the character count and the estimated remaining monthly quota.
2. Refuse to run without an explicit `--confirm` flag.
3. Skip entirely if `cache/audio/<matchId>-<style>.mp3` already exists (unless `--force`).

**Budget plan (10,000 chars total for the month):**
- Reserve ~2,500 chars for the live demo recording (including one retake).
- That leaves ~3 pre-generated demo recaps. **Pick the 3 best text recaps only.** Do not generate audio for all 9.
- If more testing headroom is needed, use a second free account with a different email for *voice auditioning only* — never for demo assets.

**Implementation:**
- ElevenLabs TTS REST endpoint, stock voice library (no cloning on free tier). Pick a voice per persona: energetic for `hype`, measured for `analyst`, soft for `bedtime`. Audition voices in their web UI (not via API) to save quota.
- Save MP3 to `cache/audio/`, commit them (demo fallback).
- **Free tier requires ElevenLabs attribution and grants no commercial rights** — add a credit line to the README, the website footer, and the submission notes. Cheap to do, avoids a compliance question from judges.

**Checkpoint:** 3 polished MP3s on disk. Quota spent is known and logged in README.

---

## 9. Phase 7 — Website (target: 90 min) — LAST STEP

Only start once Phases 2–6 are green.

- **Frontend:** single page. Match picker (the 3 cached matches) → style picker → Generate → audio player + transcript with inline **"verify on-chain"** links next to each cited fact, linking to Solana Explorer (`?cluster=devnet`).
- **Backend:** one serverless route `POST /api/recap { matchId, style }` → returns cached recap + audio URL if it exists, else runs the live pipeline. **Keys stay server-side.**
- **Design:** clean and legible beats fancy. The "verified on-chain" badge and the proof links ARE the visual identity — make them prominent, not a footnote.
- **Deploy to Vercel** so judges get a live URL. A localhost-only build risks the "functional build" bar.

**Checkpoint:** Public URL loads, all 3 cached demo recaps play instantly, verify links resolve to real devnet transactions.

---

## 10. Phase 8 — Demo video + submission (target: 60 min)

**The live generation for the video:**
- Use a 4th match, brief already cached, text NOT yet generated — so the LLM call is genuinely live on camera but the risky data-fetch step is already de-risked.
- **Have a pre-generated backup recap + audio ready.** If the live call 429s or returns a weak take, you must not be stuck re-recording under deadline pressure.
- Do a full dry run *before* recording.

**Video beats (2–3 min):**
1. The problem: AI sports content is untrustworthy slop; you can't tell what's real.
2. Live demo: pick match → pick persona → generated recap plays.
3. **The money shot:** click a "verify" link → real on-chain transaction proving that goal, at that minute, is genuine. *"Every sentence has a receipt."*
4. Show a second persona on the same match — same facts, different voice.

**Submission checklist:**
- [ ] Live URL (Vercel)
- [ ] Public GitHub repo with README (setup, architecture diagram, TxLINE integration explained)
- [ ] Demo video link
- [ ] TxLINE used as *primary data input* — state this explicitly, judges are checking for it
- [ ] ElevenLabs attribution present
- [ ] Submit on Superteam Earn **before the 19 July close** — submit a working version EARLY, polish after if time allows

---

## 11. Ordered task list for Claude Code

Work strictly top to bottom. Do not start a phase until the previous checkpoint passes.

1. Scaffold repo, `.env.example`, `.gitignore`, install deps.
2. Fetch and read TxLINE docs via `llms.txt`; record real endpoints in README.
3. Devnet keypair + airdrop; verify balance.
4. Implement `01-auth.ts`: subscribe → guest JWT → sign → activate → persist token. **Copy the official devnet examples.**
5. Implement `src/txline.ts` client with 401-refresh handling.
6. Implement `02-fetch-match.ts`; cache 3–5 completed matches raw, **with proof references**.
7. Implement `03-build-brief.ts` + zod schema + `oddsHighlights` derivation; commit briefs.
7b. **(Phase 4.5)** Extract minutes from the record `Clock`; author `cache/scorers/<id>.json` from a web2 report and compose scorer names onto verified goals via `src/scorers.ts`; re-fetch + rebuild brief. Norway–France done; roll out to the other real WC matches.
8. Audition 2–3 pinned OpenRouter free models on one brief; pick and hardcode primary + fallback.
9. Implement `src/styles.ts` (3 personas) and `04-generate-text.ts` with citation parsing + fact validation.
10. Generate 3 matches × 3 styles; human reviews; commit the good ones.
11. Implement `05-generate-audio.ts` with quota guard + `--confirm`; generate audio for the **3 best only**.
12. Implement `06-run-all.ts` (single command, end-to-end, cache-aware).
13. Build `/web` page + `/api/recap` route; wire cached assets; deploy to Vercel.
14. Record demo video (live gen on a 4th match, backup ready).
15. Write README, submit on Superteam Earn.

---

## 12. Cut list (if time runs short, drop in this order)

1. 3rd/4th persona → ship 2.
2. Live generation on the website → serve cached only, and make the live gen a CLI-demoed feature.
3. Fancy UI → plain page.
4. **Never cut:** the on-chain verify links. That's the entire pitch.