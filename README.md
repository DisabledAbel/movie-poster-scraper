# Movie Poster Scraper

This repo includes:

- `firecrawl-movie-posters.js`: Node.js script exporting `getMoviePosters(title)`.
- `index.html`: iPad-friendly webpage UI to fetch top poster JPG/JPEG URLs.

## Quick use (webpage)

Open `index.html` in a browser, enter:

1. your `FIRECRAWL_API_KEY`
2. movie title (e.g. `Inception`)

Then tap **Find Top 5 Posters**.

> Note: Browser-based use exposes the API key to the page session. For production, route requests through your backend.

## Quick use (Node.js)

```bash
FIRECRAWL_API_KEY=your_key node firecrawl-movie-posters.js "The Matrix"
```

## Deployment recommendation

- **GitHub Pages**: best for hosting `index.html` static webpage so it works on iPad.
- **Render**: best if you later add a backend API proxy to keep API keys server-side.
