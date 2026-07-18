// Phase 7 — sync the pipeline's outputs into the web app.
//
// The repo root (`../cache`, `../src`) stays canonical; this script embeds a
// snapshot the Next.js bundle can import directly, so the deployed site (Vercel)
// needs no filesystem access outside its own tree:
//   cache/briefs/*.json  ─┐
//   cache/recaps/*.json  ─┼→ web/lib/generated/data.json   (bundled, server-side)
//   cache/audio/*.mp3    ─┴→ web/public/audio/*.mp3        (static)
//   src/{types,styles,llm,recap}.ts → web/lib/pipeline/    (live-generation path)
//
// Runs automatically via predev/prebuild. Re-run any pipeline phase, then
// `npm run sync` (or just dev/build) to pick the new assets up.

import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const cacheDir = path.join(repoRoot, "cache");

async function readJsonDir(dir) {
  const out = {};
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const raw = await readFile(path.join(dir, name), "utf8");
    if (!raw.trim()) continue;
    out[name.replace(/\.json$/, "")] = JSON.parse(raw);
  }
  return out;
}

// ── 1. briefs + recaps → data.json ───────────────────────────────────────────
const briefs = await readJsonDir(path.join(cacheDir, "briefs"));
const recaps = await readJsonDir(path.join(cacheDir, "recaps"));

// ── 2. audio → public/audio ──────────────────────────────────────────────────
const audio = {};
const audioSrc = path.join(cacheDir, "audio");
const audioDst = path.join(webRoot, "public", "audio");
await mkdir(audioDst, { recursive: true });
try {
  for (const name of await readdir(audioSrc)) {
    if (!name.endsWith(".mp3")) continue;
    await copyFile(path.join(audioSrc, name), path.join(audioDst, name));
    audio[name.replace(/\.mp3$/, "")] = `/audio/${name}`;
  }
} catch {
  // no audio cached yet — the site falls back to browser narration
}

const genDir = path.join(webRoot, "lib", "generated");
await mkdir(genDir, { recursive: true });
await writeFile(
  path.join(genDir, "data.json"),
  JSON.stringify({ briefs, recaps, audio, syncedAt: new Date().toISOString() }, null, 2)
);

// ── 3. pipeline modules (for the live /api/recap path) ───────────────────────
// Copied verbatim except: relative ".js" specifiers become extensionless so the
// Next bundler resolves them back to the .ts sources.
const pipelineFiles = ["types.ts", "styles.ts", "llm.ts", "recap.ts"];
const pipeDst = path.join(webRoot, "lib", "pipeline");
await mkdir(pipeDst, { recursive: true });
for (const file of pipelineFiles) {
  const src = await readFile(path.join(repoRoot, "src", file), "utf8");
  const banner = `// AUTO-COPIED from ../src/${file} by scripts/sync.mjs — edit the original, then re-run \`npm run sync\`.\n`;
  await writeFile(
    path.join(pipeDst, file),
    banner + src.replace(/from "(\.\/[^"]+)\.js"/g, 'from "$1"')
  );
}

console.log(
  `sync: ${Object.keys(briefs).length} briefs, ${Object.keys(recaps).length} recaps, ` +
    `${Object.keys(audio).length} audio file(s), ${pipelineFiles.length} pipeline modules`
);
