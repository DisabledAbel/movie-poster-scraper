import { normalizeYear } from "../lib/poster-utils.js";
import { findPostersSequential, fetchTmdbLeadCharacter, fetchImdbLeadCharacter } from "../lib/providers.js";

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, source, sourcesTried } = await findPostersSequential(movie, year);
    
    // Try TMDB first (requires API key), then fallback to IMDB
    let leadCharacter = null;
    if (process.env.TMDB_API_KEY) {
      leadCharacter = await fetchTmdbLeadCharacter(movie, year);
    }
    if (!leadCharacter) {
      leadCharacter = await fetchImdbLeadCharacter(movie, year);
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
