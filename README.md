# Movie Poster Scraper

This repo includes:

- `firecrawl-movie-posters.js`: Node.js script exporting `getMoviePosters(title)`.
- `index.html`: iPad-friendly webpage UI to fetch top poster JPG/JPEG URLs.
- `vercel.json`: Vercel static-hosting config.

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

## Vercel: fix “No Production Deployment / domain not serving traffic”

If Vercel says your production domain is not serving traffic, verify this checklist:

1. **Production Branch** is set to your default branch in **Project Settings → Git**.
2. A **successful deployment** exists for that production branch.
3. The repo contains `index.html` and `vercel.json`.
4. If using a custom domain, DNS points to Vercel.

This repo’s `vercel.json` rewrites `/` (and any non-file route) to `index.html` so the static app is always served.

## Deployment recommendation

- **GitHub Pages**: best for simple static hosting of `index.html`.
- **Vercel**: excellent static hosting with previews and easy domain setup.
- **Render**: best if you later add a backend API proxy to keep API keys server-side.
