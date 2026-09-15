import { normalizeYear } from "../lib/poster-utils.js";
import { findPostersParallel } from "../lib/providers.js";
import { latestPosterStore, saveLatestPosterSafely } from "../lib/latest-poster-store.js";

export function createPosterSearchHandler({ findPosters = findPostersParallel, store = latestPosterStore, logger = console } = {}) {
  return async function handler(req, res) {
    try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, sourcesUsed, sourcesFailed } = await findPosters(movie, year);

    if (posters && posters.length > 0) {
      await saveLatestPosterSafely(store, movie, posters[0], logger);
    }

    res.status(200).json({
      movie,
      year,
      posters,
      bestPoster: posters[0]?.url || null,
      sourcesUsed,
      sourcesFailed,
    });
    } catch (err) {
      res.status(500).json({
        error: err.message,
      });
    }
  };
}

export default createPosterSearchHandler();
