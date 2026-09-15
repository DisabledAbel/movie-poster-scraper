import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import { findPostersSequential } from "../../lib/providers.js";
import { getCacheDirectory, getPosterCacheTtlMs } from "../../lib/cache-utils.js";

function hasUsablePosters(payload) {
  return payload
    && typeof payload === "object"
    && Array.isArray(payload.posters)
    && payload.posters.some((poster) => typeof poster === "string" && poster.trim().length > 0);
}

function readFreshPayload(entry, title, now) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

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
} = {}) {
  return async function handler(req, res) {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });

    const cacheKey = createHash("sha256").update(title).digest("hex");
    const safeFile = path.join(cacheDir, `${cacheKey}.json`);

    try {
      const entry = JSON.parse(fileSystem.readFileSync(safeFile, "utf-8"));
      const payload = readFreshPayload(entry, title, now());
      if (payload) return res.status(200).json(payload);
    } catch (err) {
      // A cache miss or an unreadable/malformed entry must not affect the lookup.
    }

    try {
      const result = await findPosters(title, null);
      const payload = { title, ...result };

      if (hasUsablePosters(payload)) {
        try {
          const entry = {
            expiresAt: new Date(now() + cacheTtlMs).toISOString(),
            payload,
          };
          fileSystem.mkdirSync(cacheDir, { recursive: true });
          fileSystem.writeFileSync(safeFile, JSON.stringify(entry));
        } catch (err) {
          // Caching is best-effort; the provider result is still a successful response.
        }
      }

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export default createPosterHandler();
