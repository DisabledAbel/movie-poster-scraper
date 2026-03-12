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

## Deploy to Vercel (fixes “No Production Deployment”)

This project is a static site. To make the production domain serve traffic:

1. Import the repo in Vercel.
2. In **Project Settings → Git**, set the **Production Branch** to your main/default branch.
3. Ensure at least one deployment exists for that branch (click **Deploy** if needed).
4. Keep the included `vercel.json` in the repo so `/` rewrites to `index.html`.

If you still see “Your Production Domain is not serving traffic”, usually one of these is true:

- no successful deployment on the production branch yet,
- project connected to the wrong branch,
- custom domain DNS not pointed to Vercel.

## Deployment recommendation

- **GitHub Pages**: best for hosting `index.html` static webpage so it works on iPad.
- **Vercel**: also great for static hosting and simpler previews.
- **Render**: best if you later add a backend API proxy to keep API keys server-side.
