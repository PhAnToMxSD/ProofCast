# ProofCast — AI Match Storyteller

Post-match AI commentary recaps generated from cryptographically verified **TxLINE** match
data, narrated as audio, with on-chain "verify this moment" proof links.

Built for the **TxODDS World Cup Hackathon** — *Consumer & Fan Experiences* track. Devnet only.

---

## Phase 1 — TxLINE API reference (authoritative notes)

> These notes were transcribed directly from the live TxLINE docs (`llms.txt` index +
> OpenAPI source at `https://txline.txodds.com/docs/docs.yaml`), **not** from memory. Key facts
> that are easy to get wrong are flagged with ⚠️ below. Verified 2026-07-18.

### Documentation map (`https://txline-docs.txodds.com/llms.txt`)

| Page | URL |
|---|---|
| Quickstart | https://txline.txodds.com/documentation/quickstart |
| World Cup Free Tier | https://txline.txodds.com/documentation/worldcup |
| Subscription Tiers | https://txline.txodds.com/documentation/subscription-tiers |
| Scores Overview / Schedule | https://txline.txodds.com/documentation/scores/overview · `/schedule` |
| Soccer Feed (encodings) | https://txline.txodds.com/documentation/scores/soccer-feed |
| Odds Overview / Coverage | https://txline.txodds.com/documentation/odds/overview · `/odds-coverage` |
| Program Reference (Devnet) | https://txline.txodds.com/documentation/programs/devnet |
| Runnable Devnet Examples | https://txline.txodds.com/documentation/examples/devnet-examples |
| Fetching Snapshots | https://txline.txodds.com/documentation/examples/fetching-snapshots |
| On-Chain Validation | https://txline.txodds.com/documentation/examples/onchain-validation |
| Troubleshooting | https://txline.txodds.com/documentation/examples/troubleshooting |
| OpenAPI YAML | https://txline.txodds.com/docs/docs.yaml |

---

### Devnet configuration (the only network we touch)

| Parameter | Value |
|---|---|
| Solana RPC | `https://api.devnet.solana.com` |
| Program ID | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL Token Mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| Guest auth host | `https://txline-dev.txodds.com/auth/guest/start` |
| API base | `https://txline-dev.txodds.com/api/` |

**Rule:** RPC, program ID, guest-JWT host and API host must ALL be devnet. Never mix networks.

---

### Onboarding flow (Phase 2 — auth)

The API token is **earned** via an on-chain subscribe + off-chain activate handshake. Order:

1. **Load devnet keypair**, assert SOL balance > 0 (airdrop `solana airdrop 2 --url devnet` if not).
   SOL is needed for tx fees + account rent. No TxL token purchase required for the free tier.
2. **Subscribe on-chain** via Anchor: `program.methods.subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)`.
   Capture the transaction signature → `txSig`.
3. **`POST /auth/guest/start`** → returns a guest **JWT** (`TokenResponse`). ⚠️ **This JWT is valid
   for 30 days**, not minutes — no per-call refresh needed; keep a single 401-retry as a safety net
   (see credential rules).
4. **Sign the activation preimage** with the SAME wallet that subscribed. Exact preimage:
   ```
   `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`
   ```
   With empty leagues (our case) this is `` `${txSig}::${jwt}` `` — **two colons**. Signature is a
   **base64-encoded detached** ed25519 signature.
5. **`POST /api/token/activate`** with header `Authorization: Bearer <jwt>` and JSON body
   `ActivationPayload` → returns the long-lived **API token** as `text/plain`
   (e.g. `txoracle_api_123abc456def`).
6. **Persist** the API token + subscription state to `cache/` so we never re-subscribe.

#### `ActivationPayload` request body ⚠️ (exact field names — note `walletSignature`, not `signature`)

```jsonc
{
  "txSig": "<subscribe tx signature>",   // required
  "walletSignature": "<base64 detached sig of the preimage>",  // required — field is `walletSignature`
  "leagues": []                          // int32[]; empty array = standard free bundle
}
```

#### Credential rules for the data client (`src/txline.ts`)

- Every authenticated data request sends **both** headers:
  - `Authorization: Bearer <jwt>`
  - `X-Api-Token: <apiToken>`
- **401** → guest JWT invalid/expired → re-`POST /auth/guest/start` from the same host, retry once
  with the same API token.
- **403** at activation → check preimage format, wallet identity, base64 signature encoding, and
  network match. **403** on data → API token invalid / insufficient permissions for that competition.

---

### Service level we use (World Cup Free Tier)

| Field | Value |
|---|---|
| `SERVICE_LEVEL_ID` | **`1`** on devnet ("World Cup & Int Friendlies"; `samplingIntervalSec = 0` → effectively real-time on devnet) |
| `SELECTED_LEAGUES` | `[]` (empty — standard free bundle; league IDs only for custom tier 3) |
| `DURATION_WEEKS` | multiples of 4 (up to 12 months). Use `4`. |
| Coverage | World Cup + International Friendlies |
| Cost | Free — no TxL payment; only SOL for fees/rent |
| Rate limits | None documented |

> Mainnet also exposes Level `12` (real-time). We are **devnet-only**, so **Level 1** is the target.

---

### Data endpoints (Phase 3 — fetch)

All under API base `https://txline-dev.txodds.com/api/`. All require the two auth headers above.

| Purpose | Method & path | Key params |
|---|---|---|
| List fixtures | `GET /api/fixtures/snapshot` | `startEpochDay?`, `competitionId?` |
| Latest score snapshot (per-action events) | `GET /api/scores/snapshot/{fixtureId}` | `asOf?` (unix ms) |
| All score updates in current 5-min window | `GET /api/scores/updates/{fixtureId}` | — |
| Historical score updates (interval) | `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}` | `fixtureId?` |
| Odds snapshot | `GET /api/odds/snapshot/{fixtureId}` | — |
| Odds updates (interval) | `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}` | — |
| **Merkle proof for a stat** | `GET /api/scores/stat-validation` | `fixtureId`, `seq`, `statKey`/`statKey2` (legacy) **or** `statKeys=1,2,…` (V2) |

`epochDay` = days since Unix epoch. `interval` = 0-indexed 5-min block within an hour (0–11).

---

### Response shapes (exact field names from OpenAPI)

#### Fixture (`GET /api/fixtures/snapshot` → `Fixture[]`)

```jsonc
{
  "FixtureId": 17952170,        // int64 — the match ID used everywhere
  "Competition": "…",
  "CompetitionId": 500005,
  "FixtureGroupId": 0,
  "StartTime": 0,               // int64 unix
  "Ts": 0,
  "Participant1": "Home Name",  "Participant1Id": 0,
  "Participant2": "Away Name",  "Participant2Id": 0,
  "Participant1IsHome": true    // maps Participant1/2 → home/away
}
```
> ⚠️ The `fixtures/snapshot` object has **no score/status field** — completion must be inferred from
> the **scores feed** (a completed match's `scoreSoccer.*.Total` + a final `statusSoccerId`), not from
> the fixture list. Docs' human-readable schedule page shows a `Score` column, but the API model
> doesn't carry it on `Fixture`.

#### Completed-match score (`GET /api/scores/snapshot/{fixtureId}` → `Scores[]`)

Returns an **array of per-action score records**. ⚠️ **The live devnet payload is PascalCase**, not
the camelCase shown in the OpenAPI `Scores` schema — verified against real data. Each record is an
atomic, individually-provable unit (its `Seq` is the key to fetch a Merkle proof). Real shape:

```jsonc
{
  "FixtureId": 17588234,
  "Seq": 1088,                 // int ≥1 — REQUIRED for stat-validation; never 0
  "Ts": 1782507564962,         // int64 ms — the on-chain-anchored timestamp
  "Action": "status",         // "goal" | "yellow_card" | "red_card" | "substitution" |
                               //   "var" | "penalty" | "game_finalised" | "status" | …
  "StatusId": 5,               // on the `status` record: 5 = finished
  "Participant1IsHome": true, "Participant1Id": 2661, "Participant2Id": 1999, "CompetitionId": 72,
  "Data": {                    // SoccerData — event detail for THIS action (PascalCase)
    "Minutes": 63,             //   ⚠️ often ABSENT in devnet specimen data
    "Participant": 1,          //   which team (1 = Participant1) — also often absent
    "PlayerId": 10094001,      //   scorer / carded player (numeric id; no name feed on devnet)
    "GoalType": "Head", "Goal": true, "Penalty": false,
    "YellowCard": false, "RedCard": false, "VAR": false
  },
  "Stats": {                   // ⭐ the workhorse — running totals keyed by numeric statKey
    "1": 1, "2": 4,            //   P1/P2 goals  →  final score lives here
    "3": 1, "4": 1,            //   yellows;  "5"/"6" reds;  "7"/"8" corners
    "1001": 1, "3002": 1, …    //   period-prefixed keys (see below)
  }
}
```

**How ProofCast reads a completed match** (see [src/fetch.ts](src/fetch.ts)):
- **Completed?** the snapshot array contains a `game_finalised` action (and a `status` record with `StatusId 5`).
- **Final score** = the `status` record's `Stats["1"]` vs `Stats["2"]`, mapped to home/away via `Participant1IsHome`.
- **`GET /scores/snapshot/{id}` returns only the LATEST record per Action type** — good for the final
  score, but NOT the full list of goals. The full timeline is reconstructed by scanning
  `GET /scores/updates/{epochDay}/{hourOfDay}/{interval}?fixtureId=…` across the match window.
  (`GET /scores/updates/{fixtureId}` is a live SSE stream — useless for finished games.)
- **Events** are extracted by walking `Stats` counter increments (a goal = `Stats[goalKey]` going up at
  some `Seq`). This is **decrement-aware**: a VAR-disallowed goal (counter N→N+1→N) is popped, so the
  event list always reconciles to the final score — no fabricated goals.
- **Proof coordinate** for any event = `{ fixtureId, Seq, statKey }`. Verified live:
  `GET /scores/stat-validation?fixtureId=…&seq=…&statKey=…` returns `statToProve` +
  `mainTreeProof`/`subTreeProof`/`statProof`.

#### Soccer stat keys (Merkle-provable statistics)

Base keys (period prefix `0` = whole game):

| statKey | Meaning |
|---|---|
| 1 / 2 | Participant1 / Participant2 total **Goals** |
| 3 / 4 | Participant1 / Participant2 total **Yellow Cards** |
| 5 / 6 | Participant1 / Participant2 total **Red Cards** |
| 7 / 8 | Participant1 / Participant2 total **Corners** |

Period prefixes add to the base key: `1000`=1st half, `2000`=half-time, `3000`=2nd half,
`4000`–`6000`=extra-time/penalties, `7000`=ET totals. e.g. `1002` = Participant2 goals at 1st half,
`3001` = Participant1 goals in 2nd half.

#### Odds (`GET /api/odds/snapshot/{fixtureId}` → `Odds[]`)

```jsonc
{
  "FixtureId": 17952170, "MessageId": "…", "Ts": 0,
  "Bookmaker": "…", "BookmakerId": 0,
  "SuperOddsType": "…",           // market type
  "MarketParameters": "…", "MarketPeriod": "…", "InRunning": true,
  "PriceNames": ["Home","Draw","Away"],   // labels …
  "Prices": [210, 330, 360]               // … positionally aligned prices
}
```
> `oddsHighlights` (biggest win-probability swings) is **computed by us** in Phase 4 from the
> `Prices`/`Ts` timeline — it is not a feed field.

---

### On-chain verification model (Phase 3/7 — the whole pitch) ⚠️ important

There is **no per-event `txSig` inside the score payloads.** Verification is a **Merkle-proof**
scheme. The chain of trust:

1. TxODDS publishes daily Merkle roots on-chain in PDA accounts of program
   `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`. PDA seeds (devnet):
   - Scores: `["daily_scores_roots", epochDay as u16 LE]`
   - Odds/batch: `["daily_batch_roots", epochDay as u16 LE]`
   - Fixtures: `["ten_daily_fixtures_roots", aligned epochDay as u16 LE]`
2. Data is a **three-level Merkle tree**: main batch root → per-fixture sub-tree → per-event
   stat sub-tree.
3. **`GET /api/scores/stat-validation?fixtureId=…&seq=…&statKey=…`** returns the proof payload:
   `subTreeProof`, `mainTreeProof`, `statProof` (arrays of `{ hash, isRightSibling }`),
   plus `statToProve`, `eventStatRoot`, `eventStatsSubTreeRoot`, and `updateStats`
   (`updateCount`, `minTimestamp`, `maxTimestamp`).
4. To **prove** a moment, submit an on-chain tx calling `validateStat` (legacy) or `validateStatV2`
   (current, multi-stat — `statKeys` order is contractually significant; response arrays
   `statsToProve`/`statProofs` map by position) against the published PDA root. **That validation
   transaction's signature** is our verifiable "receipt" for a given goal/card at a given minute.

**"Verify on-chain" link (Phase 7):** either the devnet PDA account or the validation tx, via
`https://explorer.solana.com/<address-or-tx>?cluster=devnet`.

**Reference scripts to copy** (`documentation/examples/devnet-examples`):
`subscription_free_tier.ts` (activation + odds), `subscription_scores.ts` /
`subscription_scores_1stat.ts` / `subscription_scores_v2.ts` (score validation),
`fixture_validation_view_only.ts` (view-only fixture proof).

---

## Attribution

Audio narration generated with **ElevenLabs** (free tier — attribution required, no commercial
rights). See Phase 6.
