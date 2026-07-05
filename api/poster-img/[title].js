import { findPostersSequential } from "../../lib/providers.js";
import { saveLatestPoster } from "../../lib/cache-utils.js";

export default async function handler(req, res) {
  try {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });

    // Remove .jpg extension if present (for Plex-style URLs)
    const cleanTitle = title.replace(/\.jpg$/i, "");

    const { posters } = await findPostersSequential(cleanTitle, null);

    if (posters && posters.length > 0) {
      const bestPoster = posters[0];
      const bestPosterUrl = typeof bestPoster === "string" ? bestPoster : bestPoster?.url;

      if (bestPosterUrl) {
        saveLatestPoster(cleanTitle, bestPosterUrl);

        // Redirect to the actual image URL
        res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
        return res.redirect(307, bestPosterUrl);
      }
    }

    res.status(404).json({ error: "Poster not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
