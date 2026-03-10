import FirecrawlApp from "@mendable/firecrawl-js";

export default async function handler(req, res) {
  try {
    const app = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY,
    });

    const movie = req.query.movie || "inception";

    const result = await app.search(`${movie} movie poster`, {
      limit: 5,
      scrapeOptions: {
        formats: ["links"]
      }
    });

    const posters = result.data
      .map(x => x.url)
      .filter(url => url.endsWith(".jpg") || url.endsWith(".png"));

    res.status(200).json({
      movie,
      posters
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
}
