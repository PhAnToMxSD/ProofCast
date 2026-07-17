// Phase 2 — TxLINE access.
//
//   npx tsx scripts/01-auth.ts [--force] [--help]
//
// Earns and caches a TxLINE API token via the on-chain subscribe + activate flow,
// then proves it works with one authenticated data call. Idempotent: reuses the
// cached token unless --force is passed.

import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import * as cfg from "../src/config.js";
import {
  loadAuthCache,
  loadKeypair,
  makeProgram,
  subscribeAndActivate,
  makeApiClient,
  type AuthState,
} from "../src/txline.js";

const HELP = `
ProofCast — 01-auth (Phase 2: TxLINE access, devnet only)

Usage:
  npx tsx scripts/01-auth.ts [options]

Options:
  --force     Re-subscribe and re-activate even if a cached token exists.
  --help      Show this help.

What it does:
  1. Loads (or generates) a devnet keypair at SOLANA_KEYPAIR_PATH.
  2. Ensures the wallet has devnet SOL (attempts an airdrop; falls back to
     printing a faucet instruction).
  3. Subscribes on-chain (service level ${cfg.SERVICE_LEVEL_ID}, ${cfg.DURATION_WEEKS} weeks, free World Cup bundle),
     fetches a guest JWT, signs the activation preimage, and exchanges it for a
     long-lived API token — cached to cache/auth.json so we never re-subscribe.
  4. Makes one authenticated call (fixtures snapshot) to prove the token works.

Prerequisites (the human must supply):
  · A funded devnet wallet is created for you if missing, but the public faucet
    is rate-limited — you may need https://faucet.solana.com (select Devnet).
`;

function parseArgs(argv: string[]) {
  return { force: argv.includes("--force"), help: argv.includes("--help") };
}

async function ensureKeypair(): Promise<Keypair> {
  if (fs.existsSync(cfg.KEYPAIR_PATH)) {
    const kp = loadKeypair();
    console.log(`✓ keypair loaded: ${kp.publicKey.toBase58()}`);
    return kp;
  }
  console.log(`· no keypair at ${cfg.KEYPAIR_PATH} — generating a new devnet keypair`);
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(cfg.KEYPAIR_PATH), { recursive: true });
  fs.writeFileSync(cfg.KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`✓ keypair generated: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function ensureFunds(connection: Connection, kp: Keypair): Promise<void> {
  let balance = await connection.getBalance(kp.publicKey);
  console.log(`· balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (balance >= cfg.MIN_SOL_LAMPORTS) return;

  console.log("· low balance — requesting a devnet airdrop (1 SOL)…");
  try {
    const sig = await connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "confirmed"
    );
    balance = await connection.getBalance(kp.publicKey);
    console.log(`✓ airdrop confirmed — balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  } catch (e: any) {
    console.error(`✗ airdrop failed (${e?.message ?? e}).`);
  }

  if (balance < cfg.MIN_SOL_LAMPORTS) {
    throw new Error(
      `Insufficient devnet SOL (need ≥ ${(cfg.MIN_SOL_LAMPORTS / LAMPORTS_PER_SOL).toFixed(2)}). ` +
        `The public faucet is rate-limited. Fund this wallet manually and re-run:\n` +
        `    ${kp.publicKey.toBase58()}\n` +
        `    https://faucet.solana.com  (select Devnet)`
    );
  }
}

async function testDataCall(state: AuthState): Promise<void> {
  // World Cup competitionId=72 per the official free-tier example.
  const client = makeApiClient(state);
  const url = `/fixtures/snapshot?competitionId=72`;
  console.log(`· authenticated test call: GET ${cfg.API_BASE_URL}${url}`);
  const res = await client.get(url);
  const rows = Array.isArray(res.data) ? res.data : [];
  console.log(`✓ authenticated call OK — ${rows.length} fixture(s) returned`);
  if (rows[0]) {
    const f = rows[0];
    console.log(`    e.g. ${f.Participant1} vs ${f.Participant2} (FixtureId ${f.FixtureId})`);
  }
}

async function main() {
  const { force, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(HELP);
    return;
  }

  console.log("── ProofCast Phase 2: TxLINE access (devnet) ──\n");

  const connection = new Connection(cfg.RPC_URL, "confirmed");
  const kp = await ensureKeypair();

  // Reuse cached token unless --force. Must match the current wallet.
  let state = loadAuthCache();
  if (state && !force) {
    if (state.wallet !== kp.publicKey.toBase58()) {
      console.log("· cached token is for a different wallet — ignoring it");
      state = null;
    } else {
      console.log(`✓ reusing cached API token (activated ${state.activatedAt})`);
    }
  }

  if (!state || force) {
    await ensureFunds(connection, kp);
    const program = makeProgram(connection, kp);
    console.log("· running subscribe → JWT → sign → activate…");
    state = await subscribeAndActivate(connection, program, kp);
  }

  console.log(`\n🔑 API token: ${state.apiToken}\n`);
  await testDataCall(state);

  console.log("\n✓ Phase 2 checkpoint met: live API token + one authenticated data call.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`\n✗ ${err?.message ?? err}`);
    process.exit(1);
  }
);
