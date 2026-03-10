# Movie Poster Scraper & API

This project provides a **movie poster API** using **Firecrawl** to fetch poster images. It works both **locally** and deployed on **Vercel**, with optional caching for faster access and Plex-friendly URLs.

---

## Features

* Search for movie posters by title
* Returns multiple poster URLs as JSON
* Optional caching for repeated requests
* CDN-style direct image URL endpoints for Plex or apps
* Runs locally or on Vercel serverless functions

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/DisabledAbel/movie-poster-scraper.git
cd movie-poster-scraper
```

---

### 2. Install dependencies

```bash
npm install
```

---

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
FIRECRAWL_API_KEY=your_firecrawl_api_key
```

You can obtain a Firecrawl API key from the **Firecrawl dashboard**.

---

## Local Development (localhost)

Run the API locally using Vercel CLI:

```bash
npm install -g vercel
vercel dev
```

Your API will be available at:

```text
http://localhost:3000/api/scrape
http://localhost:3000/api/poster/{movie-title}
http://localhost:3000/api/poster-img/{movie-title}.jpg
```

**Example:**

```text
http://localhost:3000/api/poster/inception
```

Returns:

```json
{
  "title": "inception",
  "posters": [
    "https://example.com/poster1.jpg",
    "https://example.com/poster2.jpg"
  ]
}
```

---

## Deployment on Vercel

1. Push your repository to GitHub:

```bash
git add .
git commit -m "Initial Vercel deployment"
git push
```

2. Go to **Vercel Dashboard → New Project → Import GitHub Repository**
3. Set environment variables in **Vercel Settings → Environment Variables**:

```
FIRECRAWL_API_KEY
```

4. Deploy. Your API will be available at:

```text
https://your-project-name.vercel.app/api/scrape
https://your-project-name.vercel.app/api/poster/{movie-title}
https://your-project-name.vercel.app/api/poster-img/{movie-title}.jpg
```

---

## API Endpoints

### 1. `/api/scrape`

Search posters for a movie:

**Request:**

```text
GET /api/scrape?movie=avatar
```

**Response:**

```json
{
  "movie": "avatar",
  "posters": [
    "https://example.com/poster1.jpg",
    "https://example.com/poster2.jpg"
  ]
}
```

---

### 2. `/api/poster/{title}`

Returns cached or freshly scraped poster URLs for `{title}`:

```text
GET /api/poster/inception
```

**Response:**

```json
{
  "title": "inception",
  "posters": [
    "https://example.com/poster1.jpg",
    "https://example.com/poster2.jpg"
  ]
}
```

---

### 3. `/api/poster-img/{title}.jpg`

Returns **first poster image** as direct URL (ideal for Plex):

```text
GET /api/poster-img/inception.jpg
```

**Behavior:** Redirects to the poster image URL. Plex or apps can fetch directly.

---

## Caching

* Cached posters are stored in `.cache/` locally.
* On Vercel, consider using **Vercel KV** or **Edge Config** for persistent caching.

---

## Use Cases

* Plex / media server poster automation
* Streaming dashboards
* Movie metadata tools
* m3u4u or other apps needing poster URLs

---

## Recommended Enhancements

* TMDB API integration for official, high-quality posters
* Persistent caching with Vercel KV or a database
* Auto-update cache on new releases

---

## License

MIT License — free to use, modify, and deploy
