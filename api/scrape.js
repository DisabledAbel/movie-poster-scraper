import FirecrawlApp from "@mendable/firecrawl-js";
import {
  POSTER_SEARCH_LIMIT,
  extractImageCandidates,
  pickTopPosterUrls,
} from "./poster/utils.js";

export default async function handler(req, res) {
  try {
    const app = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY,
    });

    const movie = req.query.movie || "inception";

    const result = await app.search(`${movie} movie poster`, {
      limit: POSTER_SEARCH_LIMIT,
      scrapeOptions: {
        formats: ["links"],
      },
    });

    const posters = pickTopPosterUrls(extractImageCandidates(result), 5);

    res.status(200).json({
      movie,
      posters,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
