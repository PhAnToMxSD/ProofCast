# ⚽ ProofCast

### The World Cup match-centre where every number is verified on-chain — and every match tells you its story out loud.

### 🔗 Live demo: **[proofcast-sol.vercel.app](https://proofcast-sol.vercel.app)**

ProofCast is a fan platform for the 2026 FIFA World Cup that turns match data into an experience:
open any fixture and get the complete stats sheet — possession, shots, shots on target, corners,
cards and goals — then choose how you want the match narrated to you and press play. It feels like
the sports app you already use, with one crucial difference: **nothing here is scraped or guessed.
Every figure and every fact is fetched and verified on-chain through [TxLINE](https://txline.txodds.com),
with a proof link a fan can click and check for themselves.**

It's the fun of a matchday recap, on a foundation of provable truth — and it's built so a completely
non-crypto fan can enjoy all of it without ever knowing a blockchain was involved.

---

## Why ProofCast

Sports fans are drowning in numbers they can't trust — every site shows different stats and none of
them can prove where the data came from. ProofCast flips that: the data layer is cryptographically
verified by TxLINE, and the experience layer is built to be genuinely delightful. Fans get
trustworthy stats *and* a personalized audio story of the match, with zero friction to get started.

---

## Features

### 🎙️ Personalized audio match recaps — our flagship

Pick a match, pick your commentator, and ProofCast generates your recap live — weaving the match's
verified TxLINE data together with the commentary style you chose — then reads it aloud to you.
Choose from three distinct personas:

- **📣 Hype Commentator** — explosive, partisan, lives and dies with every goal.
- **📊 Deadpan Stats Nerd** — dry, precise, quietly obsessed with the numbers.
- **🌙 Bedtime Story** — the match retold as a gentle, soothing tale.

Same verified facts, a completely different feel — so fans keep coming back to hear their match
*their* way.

### 🔒 Every number verified on-chain by TxLINE

This is what sets ProofCast apart from every other stats app. Goals, corners and cards come straight
from TxLINE's Merkle-proven match record; shots, shots on target and possession are tallied from
individually-proven on-chain events. Each figure carries a **"verify on-chain"** receipt that
resolves to the proof on Solana. Fans don't have to take our word for anything — they can check it.

### 📊 A full, glanceable match statistics panel

Every fixture opens with a match-centre stats sheet — possession, shots, shots on target, corners,
yellow and red cards — presented with clean comparison bars so you can read the shape of the game at
a glance. It's the complete experience fans expect, and every row is backed by a proof.

### 🪄 No wallet. No sign-up. No web3 friction.

A key part of the ProofCast experience: **fans never connect a wallet or learn anything about
crypto.** The entire web3 layer is abstracted away — users just open the site and start exploring.
That makes ProofCast a natural on-ramp for mainstream web2 sports fans, who get all the trust
benefits of on-chain data with none of the usual barriers to entry.

### 🏆 The full World Cup knockout run

ProofCast covers the entire 2026 knockout bracket — Round of 16, quarter-finals, semi-finals and the
third-place play-off — plus the group-stage fixtures, all organized into a clean, sectioned bracket.
Twenty matches, each with its full verified stats sheet and recaps in every narrator style, with the
Final ready to light up the moment it's played.

### 📎 On-chain receipts for every claim

The recap doesn't just tell you a story — it shows its work. Every fact the narrator cites links to
the exact on-chain proof for that event: the goal, the minute, the scoreline. It's storytelling you
can audit.

### 🔊 Studio-quality narration

Recaps are voiced with **ElevenLabs**, the industry standard for lifelike text-to-speech, so the
commentary sounds like a real broadcast rather than a robotic readout — warm, expressive, and
matched to each persona's character.

---

## How it works

1. **Pick a match** from the bracket — group stage through the Final.
2. **Read the stats** — the full verified match sheet, every figure proven on-chain.
3. **Choose a narrator** and generate your recap — the match's verified data is combined with your
   chosen style into a fresh transcript, generated for you on the spot.
4. **Press play** — hear the story narrated aloud, with a proof link beside every fact.

No wallet. No account. Just the match.

---

## Tech stack

- **Data & verification:** TxLINE on-chain feed, anchored to Solana.
- **Web:** Next.js (App Router), server-rendered match pages, TypeScript.
- **Audio:** ElevenLabs text-to-speech.
- **Recaps:** grounded generation that only ever cites verified facts.

---

## Quickstart — run it yourself

**Prerequisites:** Node.js 20+ and npm. The repo ships with the verified match data already
committed, so the site runs out of the box — no keys required just to explore.

```bash
# 1. clone
git clone https://github.com/PhAnToMxSD/ProofCast.git
cd ProofCast

# 2. install (root tooling + the web app)
npm install
cd web && npm install

# 3. run the site
npm run dev        # → http://localhost:3000
```

That's it — open the URL and browse every match, its verified stats and its recaps.

To enable **on-demand studio narration**, add an ElevenLabs key in `web/.env.local`:

```bash
ELEVENLABS_API_KEY=your_key_here
```

### Optional — refresh the data from TxLINE

The match data is pulled from the TxLINE devnet feed via a small pipeline (root scripts). This
step needs a funded Solana devnet keypair for TxLINE's guest onboarding; copy `.env.example` to
`.env` and fill it in first.

```bash
npm run auth                 # onboard + cache a TxLINE API token
npm run fetch -- --match <fixtureId>   # pull a match's raw feed
npm run brief -- --match <fixtureId>   # build the verified brief
node scripts/build-stats.mjs           # compute the verified stats panel
cd web && npm run sync                 # embed the refreshed data into the site
```

---

## What we use from TxLINE

ProofCast is built entirely on the **TxLINE devnet** API (`https://txline-dev.txodds.com`). Auth is
TxLINE's on-chain **guest onboarding**: a Solana devnet keypair earns a JWT and exchanges it for an
API token — no manual credentials.

| Endpoint | What we use it for |
|---|---|
| `POST /auth/guest/start` · `POST /api/token/activate` | On-chain guest onboarding → API token |
| `GET /api/fixtures/snapshot?competitionId=72&startEpochDay=…` | Discover World Cup fixtures; `FixtureGroupId` resolves each knockout round |
| `GET /api/scores/snapshot/{fixtureId}` | Final score, status and the full event timeline for a match |
| `GET /api/scores/updates/{day}/{hour}/{interval}?fixtureId=…` | Fill in the complete, ordered event stream for a fixture |
| `GET /api/scores/stat-validation?fixtureId=…&seq=…&statKey=…` | The Merkle proof for one exact stat — the "verify on-chain" receipt |
| `GET /api/odds/snapshot/{fixtureId}` | Odds / win-probability movement across the match |

**How the verification works:** every event and aggregate (goals, corners, cards) carries proof
coordinates — `fixtureId + seq + statKey` — that resolve to a Merkle root published on **Solana
devnet**. Each stat on the site links to both the Solana Explorer account holding that root and the
`stat-validation` endpoint that returns the proof for that exact figure. Shots, shots on target and
possession are tallied from the individually-proven events in the timeline.

---

Built for the **TxODDS World Cup Hackathon** — *Consumer & Fan Experiences* track.
