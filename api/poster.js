import { normalizeYear } from "../lib/poster-utils.js";
import { findPostersParallel } from "../lib/providers.js";

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, sourcesUsed, sourcesFailed } = await findPostersParallel(movie, year);

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
}
