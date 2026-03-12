# Movie Poster Scraper

This repo includes:

- `firecrawl-movie-posters.js`: Node.js script exporting `getMoviePosters(title)`.
- `index.html`: iPad-friendly webpage UI.
- `api/posters.js`: server-side API route that uses `FIRECRAWL_API_KEY` from environment variables.
- `vercel.json`: Vercel static-hosting config with SPA rewrites.

## Security change: API key in environment variables only

The webpage no longer accepts a Firecrawl API key input.

- Browser UI calls `GET /api/posters?title=...`
- `api/posters.js` reads `process.env.FIRECRAWL_API_KEY`
- API key stays server-side

## Quick use (webpage)

1. Set `FIRECRAWL_API_KEY` in your deployment environment (e.g. Vercel Project Settings → Environment Variables).
2. Open the webpage and enter a movie title.
3. Tap **Find Top 5 Posters** (or press Enter).

## Quick use (Node.js)

```bash
FIRECRAWL_API_KEY=your_key node firecrawl-movie-posters.js "The Matrix"
```

## Vercel setup checklist

If Vercel says production is not serving traffic:

1. Production Branch is set correctly.
2. At least one successful deployment exists on that branch.
3. `FIRECRAWL_API_KEY` is set in Vercel Environment Variables.
4. If using a custom domain, DNS points to Vercel.

`vercel.json` keeps `/api/*` on serverless functions and rewrites non-file routes to `index.html`.

## Deployment recommendation

- **Vercel**: recommended (static page + serverless API with env vars).
- **GitHub Pages**: not suitable for this secure mode because it cannot run server-side env vars.
- **Render**: good alternative if you want a custom backend service.
