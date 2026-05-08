import { normalizeYear } from "../lib/poster-utils.js";
import { findPostersSequential, fetchTmdbLeadCharacter } from "../lib/providers.js";

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, source, sourcesTried } = await findPostersSequential(movie, year);
    
    // Fetch lead character info if TMDB is available
    let leadCharacter = null;
    if (process.env.TMDB_API_KEY) {
      leadCharacter = await fetchTmdbLeadCharacter(movie, year);
    }

    res.status(200).json({
      movie,
      year,
      posters,
      source,
      sourcesTried,
      leadCharacter,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
