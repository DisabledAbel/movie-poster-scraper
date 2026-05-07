import { normalizeYear } from "../lib/poster-utils.js";
import { fetchTmdbSinglePoster, fetchImdbSinglePoster } from "../lib/providers.js";

export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const query = typeof req.query?.query === "string" ? req.query.query.trim() : "";
    const year = normalizeYear(req.query?.year);

    if (!query) {
      return res.status(400).json({ error: "Missing query parameter: query" });
    }

    const tmdb = await fetchTmdbSinglePoster(query, year);
    if (tmdb) {
      return res.status(200).json({ query, image: tmdb.image, source: tmdb.source });
    }

    const imdb = await fetchImdbSinglePoster(query, year);
    if (imdb) {
      return res.status(200).json({ query, image: imdb.image, source: imdb.source });
    }

    return res.status(404).json({ query, error: "No image found" });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}
