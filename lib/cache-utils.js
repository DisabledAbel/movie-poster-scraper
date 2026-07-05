import fs from "fs";
import path from "path";
import os from "os";

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

// On Vercel, we can only write to /tmp
const IS_VERCEL = process.env.VERCEL || process.env.NOW_REGION;
const CACHE_DIR = IS_VERCEL ? path.join(os.tmpdir(), "movie-poster-cache") : path.resolve(".cache");

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

    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const latestFile = path.join(CACHE_DIR, "latest.json");
    fs.writeFileSync(latestFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save latest poster:", err);
  }
}

export function getLatestPoster() {
  try {
    if (memoryLatest) return memoryLatest;

    const latestFile = path.join(CACHE_DIR, "latest.json");
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
