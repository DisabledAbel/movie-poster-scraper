import { LatestPosterStorageError, latestPosterStore } from "../lib/latest-poster-store.js";

function disableCaching(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function createLatestPosterHandler({ store = latestPosterStore, logger = console } = {}) {
  return async function handler(req, res) {
    disableCaching(res);
    try {
      const latest = await store.getLatestPoster();

      if (!latest || !latest.url) {
        return res.status(404).json({ error: "No latest poster found" });
      }

      if (req.query && req.query.json === "1") return res.status(200).json(latest);
      return res.redirect(307, latest.url);
    } catch (error) {
      logger.error("Failed to read latest poster:", error.message, error.cause?.message || "");
      const message = error instanceof LatestPosterStorageError
        ? "Latest poster storage is temporarily unavailable"
        : "Unable to load latest poster";
      return res.status(503).json({ error: message });
    }
  };
}

export default createLatestPosterHandler();
