// Central config for ProofCast. All values are DEVNET. Never mix networks.
// Sourced from the TxLINE docs + the official tx-on-chain devnet examples.
import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root (…/ProofCast). config.ts lives in src/.
export const ROOT = path.resolve(__dirname, "..");
export const CACHE_DIR = path.join(ROOT, "cache");
export const RAW_DIR = path.join(CACHE_DIR, "raw");
export const AUTH_CACHE = path.join(CACHE_DIR, "auth.json");

// ── Solana devnet ────────────────────────────────────────────────────────────
export const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const KEYPAIR_PATH = path.resolve(
  ROOT,
  process.env.SOLANA_KEYPAIR_PATH ?? "./.keys/devnet.json"
);
export const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
export const TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");

// ── TxLINE devnet hosts ──────────────────────────────────────────────────────
export const API_BASE_URL = "https://txline-dev.txodds.com/api";
export const JWT_URL = "https://txline-dev.txodds.com/auth/guest/start";
export const ACTIVATE_URL = `${API_BASE_URL}/token/activate`;

// ── Free World Cup tier (devnet) ─────────────────────────────────────────────
// Service level 1 = "World Cup & Int Friendlies"; empty leagues = standard bundle.
// weeks must be a multiple of 4 (min 4).
export const SERVICE_LEVEL_ID = 1;
export const DURATION_WEEKS = 4;
export const SELECTED_LEAGUES: number[] = [];

// Minimum SOL (lamports) we want on the wallet before attempting to subscribe.
export const MIN_SOL_LAMPORTS = 0.05 * 1e9;
