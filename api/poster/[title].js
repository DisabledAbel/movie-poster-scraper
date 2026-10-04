import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import { findPostersSequential } from "../../lib/providers.js";
import { getCacheDirectory, getPosterCacheTtlMs, POSTER_CACHE_VERSION } from "../../lib/cache-utils.js";
import { normalizeYear } from "../../lib/poster-utils.js";
import { latestPosterStore, saveLatestPosterSafely } from "../../lib/latest-poster-store.js";

function hasUsablePosters(payload) {
  return payload
    && typeof payload === "object"
    && Array.isArray(payload.posters)
    && payload.posters.some((poster) => typeof poster === "string" && poster.trim().length > 0);
}

function readFreshPayload(entry, title, year, now) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (entry.version !== POSTER_CACHE_VERSION || entry.year !== year) return null;

  const expiresAt = Date.parse(entry.expiresAt);
  const payload = entry.payload;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  if (!hasUsablePosters(payload) || payload.title !== title) return null;

  return payload;
}

export function createPosterHandler({
  findPosters = findPostersSequential,
  cacheDir = getCacheDirectory(),
  fileSystem = fs,
  cacheTtlMs = getPosterCacheTtlMs(),
  now = Date.now,
  latestStore = latestPosterStore,
  logger = console,
} = {}) {
  return async function handler(req, res) {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });
    const year = normalizeYear(req.query.year);

    const cacheKey = createHash("sha256").update(year === null ? title : `${title}\0${year}`).digest("hex");
    const safeFile = path.join(cacheDir, `${cacheKey}.json`);

    try {
      const entry = JSON.parse(fileSystem.readFileSync(safeFile, "utf-8"));
      const payload = readFreshPayload(entry, title, year, now());
      if (payload) {
        await saveLatestPosterSafely(latestStore, title, payload.posters[0], logger);
        return res.status(200).json(payload);
      }
    } catch (err) {
      // A cache miss or an unreadable/malformed entry must not affect the lookup.
    }

    try {
      const result = await findPosters(title, year);
      const payload = { title, ...result };

      if (hasUsablePosters(payload)) {
        try {
          const entry = {
            version: POSTER_CACHE_VERSION,
            year,
            expiresAt: new Date(now() + cacheTtlMs).toISOString(),
            payload,
          };
          fileSystem.mkdirSync(cacheDir, { recursive: true });
          fileSystem.writeFileSync(safeFile, JSON.stringify(entry));
        } catch (err) {
          // Caching is best-effort; the provider result is still a successful response.
        }
        await saveLatestPosterSafely(latestStore, title, payload.posters[0], logger);
      }

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export default createPosterHandler();
