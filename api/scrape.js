import { normalizeYear } from "../lib/poster-utils.js";
import { findPostersSequential } from "../lib/providers.js";
import { saveLatestPoster } from "../lib/cache-utils.js";

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, source, sourcesTried } = await findPostersSequential(movie, year);

    if (posters && posters.length > 0) {
      saveLatestPoster(movie, posters[0]);
    }

    res.status(200).json({
      movie,
      year,
      posters,
      source,
      sourcesTried,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
