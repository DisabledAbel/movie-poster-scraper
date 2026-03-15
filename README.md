# Movie Poster Scraper & API

This project provides a **movie poster API** using **Firecrawl** to fetch poster images. It works deployed on **Vercel**, with optional caching for faster access and Plex-friendly URLs.

---

## Features

* Search for movie posters by title
* Returns multiple poster URLs as JSON
* Optional caching for repeated requests
* CDN-style direct image URL endpoints for Plex or apps

---


## Run locally (Windows + Linux)

### Prerequisites

- Node.js 18+
- npm 9+
- A Firecrawl API key (**Fallback IMDb endpoint if there is no API key in ENVs.**

### 1) Install dependencies

```bash
npm install
```

### 2) Create local environment file

Copy `.env.local.example` to `.env.local` and set your key:

```bash
cp .env.local.example .env.local
```

Set:

```text
FIRECRAWL_API_KEY=your_firecrawl_api_key_here
```

### 3) Start locally

#### Linux / macOS

```bash
npm run dev:linux
```

#### Windows (PowerShell)

```powershell
npm run dev:windows
```

### 4) Open the app

- App: `http://localhost:3000`
- API: `http://localhost:3000/api/scrape?movie=inception`

You can also run the shared command directly on any platform:

```bash
npm run dev
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

```text
FIRECRAWL_API_KEY
```

Value: your Firecrawl API key.
**Fallback IMDb endpoint if there is no API key in ENVs.**

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
GET /api/scrape?movie=the+thing&year=1982
```

`year` is optional and helps disambiguate movies with the same title.

**Response:**

```json
{
  "movie": "avatar",
  "year": null,
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
