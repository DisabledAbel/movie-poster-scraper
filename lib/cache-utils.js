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
 * This directory is only for the best-effort poster-result cache. Latest-poster
 * state uses the shared adapter in latest-poster-store.js in production.
 */

// On Vercel, only the operating system's temporary directory is writable.
export function getCacheDirectory(env = process.env) {
  const isVercel = env.VERCEL || env.NOW_REGION;
  return isVercel ? path.join(os.tmpdir(), "movie-poster-cache") : path.resolve(".cache");
}

// Latest-poster state lives in lib/latest-poster-store.js. Poster-result caching
// remains deliberately separate and best-effort.
