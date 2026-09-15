# Movie Poster Scraper & API

This project provides a **movie poster API** using **Firecrawl** to fetch poster images. It works deployed on **Vercel**, with optional caching for faster access and Plex-friendly URLs.

---

## Features

* Search for movie posters by title
* Returns multiple poster URLs as JSON
* Optional caching for repeated requests
* Multi-source fallback chain (Firecrawl → IMDb → iTunes → Wikipedia)
* CDN-style direct image URL endpoints for Plex or apps

---


## Run locally (Windows + Linux)

### Prerequisites

- Node.js 22+
- npm 10+
- Firecrawl API key is optional (when omitted, the scraper falls back to IMDb/iTunes/Wikipedia sources).

### 1) Clone the repository

```basħ
https://github.com/DisabledAbel/movie-poster-scraper.git
```
then:
```bash
cd movie-poster-scraper
```

### 2) Install dependencies

```bash
npm ci
```

### 3) Create local environment file

Copy `.env.local.example` to `.env.local` and set your key:

```bash
cp .env.local.example .env.local
```

Set:

```text
FIRECRAWL_API_KEY=your_firecrawl_api_key_here
# Optional sequential-search deadlines in milliseconds:
PROVIDER_TIMEOUT_MS=5000
POSTER_SEARCH_TIMEOUT_MS=25000
```

### 4) Start locally

#### Linux / macOS

```bash
npm run dev:linux
```

#### Windows (PowerShell)

```powershell
npm run dev:windows
```

### 5) Open the app

- App: `http://localhost:3000`
- API: `http://localhost:3000/api/scrape?movie=inception`

You can also run the shared command directly on any platform:

```bash
npm run dev
```

## Continuous integration

Pushes and pull requests run the following commands against the checked-out
source on Node.js 22:

```bash
npm ci
npm run --if-present lint
npm run --if-present build
npm test
```

Lint and build are optional because this project does not currently define those
scripts; if either is added, its failures will fail CI. The test suite imports the
local API handlers and supplies in-memory poster-provider and storage doubles, so
pull requests do not need API keys, shared-storage credentials, a Vercel login, or
network access. Monitoring of the deployed service remains in the separate
`Health Check` workflow.

---


## CLI: Save a poster JPG to local disk

You can run the standalone script to fetch poster URLs and optionally download one as a local `.jpg` file:

```bash
node firecrawl-movie-posters.js "The Matrix"
```

Save the best match to a local file:

```bash
node firecrawl-movie-posters.js "The Matrix" --save
```

Save to a custom location:

```bash
node firecrawl-movie-posters.js "The Matrix" --save --output ./posters/the-matrix.jpg
```

Choose which result to save (0-based index):

```bash
node firecrawl-movie-posters.js "The Matrix" --save --index 1
```

Optionally, set `FIRECRAWL_API_KEY` to include Firecrawl as an additional source, but it is not required for CLI usage.

---

## Deployment on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/DisabledAbel/movie-poster-scraper)

2. Go to **Vercel Dashboard → New Project → Import GitHub Repository**
3. Set environment variables in **Vercel Settings → Environment Variables**:

```text
FIRECRAWL_API_KEY
PROVIDER_TIMEOUT_MS
POSTER_SEARCH_TIMEOUT_MS
POSTER_CACHE_TTL_MS
KV_REST_API_URL
KV_REST_API_TOKEN
LATEST_POSTER_STORAGE_TIMEOUT_MS
LATEST_POSTER_REDIS_KEY
```

The timeout variables are optional and default to 5 seconds per provider and 25 seconds for the complete sequential search. This leaves response time for the API before Vercel's 30-second function limit.

`POSTER_CACHE_TTL_MS` is optional and controls how long successful poster searches
remain cached, in milliseconds. It must be a positive number and defaults to 24
hours (`86400000`). Expired, empty, malformed, and legacy cache entries are ignored.
Empty results and provider failures are not cached, so a later request retries the
providers. Cache reads and writes remain best-effort.

`KV_REST_API_URL` and `KV_REST_API_TOKEN` configure the Redis-compatible REST store
used for the application-wide latest-poster record. Vercel KV variables are used
directly; `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are also accepted.
The store must support the Upstash Redis REST `GET` and `SET` command endpoints.
Production deployments intentionally return a controlled 503 from the latest-poster
endpoint when shared storage is missing or unavailable instead of falling back to
an instance-local file. `LATEST_POSTER_STORAGE_TIMEOUT_MS` is optional and defaults
to 2000 ms; `LATEST_POSTER_REDIS_KEY` optionally changes the shared key. These
values are server-side secrets/settings and must not be added to browser code or
committed with real credentials.

Value: your Firecrawl API key.
**When FIRECRAWL_API_KEY is missing, the app falls back to IMDb/iTunes/Wikipedia sources.**

4. Deploy. Your API will be available at:

```text
https://your-project-name.vercel.app/api/scrape
https://your-project-name.vercel.app/api/poster/{movie-title}
https://your-project-name.vercel.app/api/poster-img/{movie-title}.jpg
https://your-project-name.vercel.app/latest-poster.jpg
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
  ],
  "source": "imdb",
  "sourcesTried": ["firecrawl", "imdb"]
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
  ],
  "source": "imdb",
  "sourcesTried": ["firecrawl", "imdb"]
}
```

---

### 3. `/api/poster-img/{title}.jpg`

Returns **first poster image** as direct URL (ideal for Plex):

```text
GET /api/poster-img/inception.jpg
```

**Behavior:** Redirects to the poster image URL. Plex or apps can fetch directly.

### 4. `/latest-poster.jpg`

Returns the **most recently searched poster image** as a direct URL:

```text
GET /latest-poster.jpg
```

**Behavior:** Redirects to the last successfully searched movie poster. Useful for dynamic displays or automated updates without specifying a title.

`GET /api/latest-poster?json=1` returns the same record as JSON, including `title`,
`url`, and `timestamp`. Both JSON and redirect responses disable browser and CDN
caching so callers see the current shared record.

---

## Caching

* Cached posters are stored in `.cache/` locally.
* Only successful searches containing usable poster URLs are cached. Entries expire
  after `POSTER_CACHE_TTL_MS` (24 hours by default); cache metadata is never included
  in API responses.
* On Vercel, cached posters use the operating system's temporary directory because
  the deployed application filesystem is read-only. This cache is ephemeral, may
  be discarded between invocations, and is not shared persistent storage.
* Latest-poster state is separate: deployed environments require the shared Redis
  REST configuration above. Local development needs no Redis credentials and uses
  `.cache/latest.json`, allowing state to survive local process restarts.

---

## Use Cases

* Plex / media server poster automation
* Streaming dashboards
* Movie metadata tools
