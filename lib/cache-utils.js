import fs from "fs";
import path from "path";
import os from "os";

export const DEFAULT_POSTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Return the configured poster-cache lifetime, falling back for invalid values. */
export function getPosterCacheTtlMs(env = process.env) {
  const configured = Number(env.POSTER_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_POSTER_CACHE_TTL_MS;
}

/**
 * Note on Vercel/Serverless:
 * Serverless functions are stateless. Writing to /tmp or using in-memory variables
 * only works for the duration of the current execution and might be shared across
 * warm instances, but is NOT a reliable persistent store.
 *
 * For a production-ready "latest poster" feature on Vercel, consider using:
 * - Vercel KV (Redis)
 * - A database (Supabase, Upstash, etc.)
 * - Upstash Redis
 */

// On Vercel, only the operating system's temporary directory is writable.
export function getCacheDirectory(env = process.env) {
  const isVercel = env.VERCEL || env.NOW_REGION;
  return isVercel ? path.join(os.tmpdir(), "movie-poster-cache") : path.resolve(".cache");
}

// In-memory fallback for the current process
let memoryLatest = null;

export function saveLatestPoster(title, urlOrObject) {
  try {
    const url = typeof urlOrObject === "string" ? urlOrObject : urlOrObject?.url;
    if (!url) return;

    const data = {
      title,
      url,
      timestamp: new Date().toISOString(),
    };

    memoryLatest = data;

    const cacheDir = getCacheDirectory();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const latestFile = path.join(cacheDir, "latest.json");
    fs.writeFileSync(latestFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save latest poster:", err);
  }
}

export function getLatestPoster() {
  try {
    if (memoryLatest) return memoryLatest;

    const latestFile = path.join(getCacheDirectory(), "latest.json");
    if (fs.existsSync(latestFile)) {
      const data = JSON.parse(fs.readFileSync(latestFile, "utf-8"));
      memoryLatest = data;
      return data;
    }
  } catch (err) {
    console.error("Failed to read latest poster:", err);
  }
  return null;
}
