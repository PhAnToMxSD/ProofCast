// TxLINE auth + data client for ProofCast (devnet only).
//
// The subscribe → guest-JWT → sign → activate handshake and the exact account
// list are copied from the official tx-on-chain devnet example
// (examples/devnet/common/users.ts). Adapted to persist the earned API token so
// we never re-subscribe, and to build the provider from our own keypair rather
// than Anchor's env provider.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import axios, { AxiosInstance } from "axios";
import nacl from "tweetnacl";
import fs from "node:fs";

import type { Txoracle } from "./idl/txoracle.js";
import TxoracleIdl from "./idl/txoracle.json" with { type: "json" };
import * as cfg from "./config.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AuthState = {
  wallet: string; // base58 pubkey that subscribed
  apiToken: string; // long-lived B2B token
  jwt: string; // guest session JWT (30-day)
  subscribeTxSig: string;
  serviceLevelId: number;
  selectedLeagues: number[];
  activatedAt: string;
};

// ── Persistence ──────────────────────────────────────────────────────────────

export function loadAuthCache(): AuthState | null {
  if (!fs.existsSync(cfg.AUTH_CACHE)) return null;
  try {
    return JSON.parse(fs.readFileSync(cfg.AUTH_CACHE, "utf8")) as AuthState;
  } catch {
    return null;
  }
}

function saveAuthCache(state: AuthState): void {
  fs.mkdirSync(cfg.CACHE_DIR, { recursive: true });
  fs.writeFileSync(cfg.AUTH_CACHE, JSON.stringify(state, null, 2));
}

// ── Solana / Anchor wiring ───────────────────────────────────────────────────

export function loadKeypair(): Keypair {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(cfg.KEYPAIR_PATH, "utf8")));
  return Keypair.fromSecretKey(secret);
}

export function makeProgram(connection: Connection, keypair: Keypair): Program<Txoracle> {
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  return new Program<Txoracle>(TxoracleIdl as unknown as Txoracle, provider);
}

// ── Guest JWT ────────────────────────────────────────────────────────────────

async function fetchGuestJwt(): Promise<string> {
  const res = await axios.post(cfg.JWT_URL);
  const jwt = res.data?.token;
  if (!jwt) throw new Error("guest/start returned no token");
  return jwt;
}

// ── On-chain subscribe + activation ──────────────────────────────────────────

/**
 * Full first-time acquisition: ensure Token-2022 ATA, subscribe on-chain, fetch
 * a guest JWT, sign the activation preimage, and exchange it for an API token.
 * Returns the persisted AuthState.
 */
export async function subscribeAndActivate(
  connection: Connection,
  program: Program<Txoracle>,
  keypair: Keypair
): Promise<AuthState> {
  const user = keypair.publicKey;

  if (cfg.DURATION_WEEKS < 4 || cfg.DURATION_WEEKS % 4 !== 0) {
    throw new Error(`DURATION_WEEKS must be a multiple of 4 (got ${cfg.DURATION_WEEKS})`);
  }

  // 1. Ensure the user's Token-2022 associated token account exists.
  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    cfg.TOKEN_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  if (!(await connection.getAccountInfo(userTokenAccountAddress))) {
    console.log("  · creating Token-2022 associated token account…");
    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        user,
        userTokenAccountAddress,
        user,
        cfg.TOKEN_MINT,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: "confirmed",
    });
    await delay(3000);
  }

  // Confirm the ATA is visible to the RPC before subscribing.
  let attempts = 0;
  while (attempts < 5) {
    try {
      await getAccount(connection, userTokenAccountAddress, "confirmed", TOKEN_2022_PROGRAM_ID);
      break;
    } catch (err: any) {
      if (err.name === "TokenAccountNotFoundError" && ++attempts < 5) {
        console.log(`  · RPC not synced, retrying ATA fetch (${attempts}/5)…`);
        await delay(2000);
      } else {
        throw err;
      }
    }
  }

  // 2. Subscribe on-chain.  subscribe(service_level_id: u16, weeks: u8)
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    cfg.TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(
    `  · subscribing on-chain: level ${cfg.SERVICE_LEVEL_ID}, ${cfg.DURATION_WEEKS} weeks…`
  );
  const subscribeTxSig = await program.methods
    .subscribe(cfg.SERVICE_LEVEL_ID, cfg.DURATION_WEEKS)
    .accounts({
      user,
      pricingMatrix: pricingMatrixPda,
      tokenMint: cfg.TOKEN_MINT,
      userTokenAccount: userTokenAccountAddress,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });
  console.log(`  · subscribe tx confirmed: ${subscribeTxSig}`);

  // 3. Guest JWT.
  const jwt = await fetchGuestJwt();

  // 4. Sign the activation preimage with the SAME wallet.
  //    preimage = `${txSig}:${leagues.join(",")}:${jwt}` — empty leagues => two colons.
  const preimage = `${subscribeTxSig}:${cfg.SELECTED_LEAGUES.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(new TextEncoder().encode(preimage), keypair.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  // 5. Activate → API token (returned as text/plain or { token }).
  const activation = await axios.post(
    cfg.ACTIVATE_URL,
    { txSig: subscribeTxSig, walletSignature, leagues: cfg.SELECTED_LEAGUES },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const apiToken: string = activation.data?.token ?? activation.data;
  if (!apiToken || typeof apiToken !== "string") {
    throw new Error("activation returned no API token");
  }

  // 6. Persist.
  const state: AuthState = {
    wallet: user.toBase58(),
    apiToken,
    jwt,
    subscribeTxSig,
    serviceLevelId: cfg.SERVICE_LEVEL_ID,
    selectedLeagues: cfg.SELECTED_LEAGUES,
    activatedAt: new Date().toISOString(),
  };
  saveAuthCache(state);
  return state;
}

// ── Authenticated data client (JWT + API token, with 401 refresh) ────────────

/**
 * Build an axios client that sends both auth headers and, on a 401 (expired
 * guest JWT), fetches a fresh JWT once and retries with the same API token.
 * The refreshed JWT is written back to the auth cache.
 */
export function makeApiClient(state: AuthState): AxiosInstance {
  let jwt = state.jwt;
  const client = axios.create({ baseURL: cfg.API_BASE_URL });

  client.interceptors.request.use((c) => {
    c.headers.set("Authorization", `Bearer ${jwt}`);
    c.headers.set("X-Api-Token", state.apiToken);
    return c;
  });

  client.interceptors.response.use(
    (r) => r,
    async (error) => {
      const original = error.config as any;
      if (error.response?.status === 401 && original && !original._retry) {
        original._retry = true;
        console.log("  · guest JWT rejected (401); renewing…");
        jwt = await fetchGuestJwt();
        saveAuthCache({ ...state, jwt });
        state.jwt = jwt;
        original.headers = { ...original.headers, Authorization: `Bearer ${jwt}` };
        return client(original);
      }
      return Promise.reject(error);
    }
  );

  return client;
}
