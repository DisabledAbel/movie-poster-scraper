import { normalizeYear, posterScore, dedupePosterUrls } from "../lib/poster-utils.js";
import { findPostersParallel } from "../lib/providers.js";

function buildPosterObjects(urls, sourcesUsed) {
  return urls.map((url) => {
    const score = posterScore(url);
    return {
      url,
      score,
      confidence: Math.min(100, 50 + score * 10),
      provider: sourcesUsed[0] || "unknown",
    };
  });
}

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, sourcesUsed, sourcesFailed } = await findPostersParallel(movie, year);

    const posterObjects = buildPosterObjects(posters, sourcesUsed);
    const deduped = dedupePosterUrls(posterObjects.map((p) => p.url))
      .map((url) => posterObjects.find((p) => p.url === url))
      .filter(Boolean)
      .filter((p) => p.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    res.status(200).json({
      movie,
      year,
      posters: deduped,
      bestPoster: deduped[0]?.url || null,
      sourcesUsed,
      sourcesFailed,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
