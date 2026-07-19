// Merkle-proof proxy: GET /api/proof?fixtureId=…&seq=…&statKey=…
//
// TxLINE's stat-validation endpoint returns the Merkle proof for one exact stat,
// but it requires two auth headers (a short-lived guest JWT + the long-lived API
// token) — so a raw link from the browser just 401s. This route authenticates
// server-side (refreshing the guest JWT as needed, which is a keyless POST) and
// returns the proof JSON, so the "verify on-chain" links actually resolve for a
// fan clicking them.

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TXLINE = "https://txline-dev.txodds.com";
const GUEST_START = `${TXLINE}/auth/guest/start`;
const STAT_VALIDATION = `${TXLINE}/api/scores/stat-validation`;

// The long-lived API token: env first (Vercel), then the local auth cache.
function apiToken(): string | null {
  if (process.env.TXLINE_API_TOKEN) return process.env.TXLINE_API_TOKEN;
  try {
    const p = path.join(process.cwd(), "..", "cache", "auth.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).apiToken ?? null;
  } catch {
    return null;
  }
}

// Cache the guest JWT in memory (they're short-lived but cheap to refresh).
let cachedJwt: { token: string; at: number } | null = null;
const JWT_TTL_MS = 10 * 60 * 1000;

async function guestJwt(force = false): Promise<string> {
  if (!force && cachedJwt && Date.now() - cachedJwt.at < JWT_TTL_MS) return cachedJwt.token;
  const res = await fetch(GUEST_START, { method: "POST" });
  if (!res.ok) throw new Error(`guest/start ${res.status}`);
  const token = (await res.json())?.token;
  if (!token) throw new Error("guest/start returned no token");
  cachedJwt = { token, at: Date.now() };
  return token;
}

async function fetchProof(url: string, token: string, jwt: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": token },
  });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const fixtureId = q.get("fixtureId");
  const seq = q.get("seq");
  const statKey = q.get("statKey");

  if (![fixtureId, seq, statKey].every((v) => v && /^\d+$/.test(v))) {
    return NextResponse.json(
      { error: "fixtureId, seq and statKey are required numeric query params." },
      { status: 400 }
    );
  }

  const token = apiToken();
  if (!token) {
    return NextResponse.json(
      { error: "Proof service is not configured (TXLINE_API_TOKEN missing on this deployment)." },
      { status: 503 }
    );
  }

  const url = `${STAT_VALIDATION}?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`;

  try {
    let jwt = await guestJwt();
    let res = await fetchProof(url, token, jwt);
    if (res.status === 401) {
      jwt = await guestJwt(true); // stale JWT — refresh once and retry
      res = await fetchProof(url, token, jwt);
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `TxLINE stat-validation returned ${res.status}.` },
        { status: 502 }
      );
    }
    const proof = await res.json();
    // Pretty-print so a fan clicking the link sees readable proof data.
    return new NextResponse(JSON.stringify(proof, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `proof lookup failed: ${message}` }, { status: 502 });
  }
}
