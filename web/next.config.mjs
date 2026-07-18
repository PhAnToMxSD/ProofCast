import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Flags are plain <img> from flagcdn.com (with emoji fallback) — no image
  // optimization pipeline needed for a 5-match demo page.
  reactStrictMode: true,
  // The repo root has its own lockfile (the pipeline package); pin tracing to
  // this app so Next doesn't guess the workspace root.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
