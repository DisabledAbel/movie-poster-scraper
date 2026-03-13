import FirecrawlApp from "@mendable/firecrawl-js";
import { searchPosterCandidates } from "./poster/utils.js";

export default async function handler(req, res) {
  try {
    const app = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY,
    });

    const movie = req.query.movie || "inception";

    const posters = await searchPosterCandidates(app, movie);

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
