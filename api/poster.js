import FirecrawlApp from "@mendable/firecrawl-js";

/* -----------------------------
   SAFE URL HELPERS
----------------------------- */

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizeImageUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[),.;:!?]+$/g, "");
}

function looksLikeCleanImageUrl(url) {
  const parsed = safeParseUrl(url);
  if (!parsed) return false;

  const full = `${parsed.pathname}${parsed.search}`.toLowerCase();

  if (!/\.(jpe?g)(?:$|[?#])/.test(full)) return false;
  if (/[<>{}[\]`]/.test(full)) return false;

  return true;
}

/* -----------------------------
   DEDUPE + SCORING
----------------------------- */

function canonicalPosterKey(url) {
  const parsed = safeParseUrl(url);
  if (!parsed) return null;
  return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
}

function dedupePosterUrls(urls) {
  const seen = new Set();
  const out = [];

  for (const url of urls) {
    const key = canonicalPosterKey(url);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(url);
    }
  }

  return out;
}

function posterScore(url, provider) {
  let score = 0;
  const lower = url.toLowerCase();

  if (/(poster|cover)/.test(lower)) score += 3;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;

  if (provider === "tmdb") score += 5;
  if (provider === "imdb") score += 2;

  if (lower.includes("/original/")) score += 3;

  if (/(thumb|icon|logo)/.test(lower)) score -= 3;

  return score;
}

function buildPosterObjects(urls, provider) {
  return urls.map((url) => {
    const score = posterScore(url, provider);
    return {
      url,
      score,
      confidence: Math.min(100, 50 + score * 10),
      provider,
    };
  });
}

/* -----------------------------
   TIMEOUT WRAPPER
----------------------------- */

function withTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

/* -----------------------------
   PROVIDERS
----------------------------- */

// 🔥 TMDB (PRIMARY)
async function fetchTmdb(movie, year) {
  if (!process.env.TMDB_API_KEY) {
    return { provider: "tmdb", posters: [] };
  }

  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(
    movie
  )}${year ? `&year=${year}` : ""}`;

  const res = await fetch(url);
  if (!res.ok) return { provider: "tmdb", posters: [] };

  const data = await res.json();
  const movieData = data?.results?.[0];
  if (!movieData) return { provider: "tmdb", posters: [] };

  const paths = [movieData.poster_path, movieData.backdrop_path].filter(Boolean);

  const urls = paths.flatMap((p) => [
    `https://image.tmdb.org/t/p/w500${p}`,
    `https://image.tmdb.org/t/p/original${p}`,
  ]);

  const valid = urls.filter(looksLikeCleanImageUrl);

  return {
    provider: "tmdb",
    posters: buildPosterObjects(valid, "tmdb"),
  };
}

// IMDb
async function fetchImdb(movie) {
  const url = `https://v3.sg.media-imdb.com/suggestion/${movie[0].toLowerCase()}/${encodeURIComponent(
    movie
  )}.json`;

  const res = await fetch(url);
  if (!res.ok) return { provider: "imdb", posters: [] };

  const data = await res.json();

  const urls =
    data?.d
      ?.map((x) => x?.i?.imageUrl)
      .filter((u) => typeof u === "string") || [];

  return {
    provider: "imdb",
    posters: buildPosterObjects(urls, "imdb"),
  };
}

// iTunes
async function fetchItunes(movie) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    movie
  )}&media=movie`;

  const res = await fetch(url);
  if (!res.ok) return { provider: "itunes", posters: [] };

  const data = await res.json();

  const urls =
    data?.results
      ?.map((x) =>
        x?.artworkUrl100?.replace(
          /\/\d+x\d+bb\.(jpg|jpeg)$/i,
          "/1000x1000bb.$1"
        )
      )
      .filter(Boolean) || [];

  return {
    provider: "itunes",
    posters: buildPosterObjects(urls, "itunes"),
  };
}

// Wikipedia
async function fetchWikipedia(movie, year) {
  const title = year ? `${movie} (${year} film)` : `${movie} (film)`;

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title
  )}`;

  const res = await fetch(url);
  if (!res.ok) return { provider: "wikipedia", posters: [] };

  const data = await res.json();

  const urls = [
    data?.originalimage?.source,
    data?.thumbnail?.source,
  ].filter(Boolean);

  return {
    provider: "wikipedia",
    posters: buildPosterObjects(urls, "wikipedia"),
  };
}

// Firecrawl
async function fetchFirecrawl(movie) {
  const app = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_API_KEY,
  });

  const result = await app.search(`${movie} movie poster`, {
    limit: 5,
  });

  const urls = JSON.stringify(result).match(/https?:\/\/[^\s"]+\.jpg/gi) || [];

  return {
    provider: "firecrawl",
    posters: buildPosterObjects(urls, "firecrawl"),
  };
}

/* -----------------------------
   PARALLEL WORKFLOW
----------------------------- */

async function findPosters(movie, year) {
  const providers = [
    () => fetchTmdb(movie, year),
    () => fetchImdb(movie),
    () => fetchItunes(movie),
    () => fetchWikipedia(movie, year),
    () => fetchFirecrawl(movie),
  ];

  const results = await Promise.allSettled(
    providers.map((fn) => withTimeout(fn(), 2500))
  );

  const posters = [];
  const sourcesUsed = [];
  const sourcesFailed = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { provider, posters: p } = result.value;

      if (p.length) {
        posters.push(...p);
        sourcesUsed.push(provider);
      } else {
        sourcesFailed.push(provider);
      }
    } else {
      sourcesFailed.push("unknown");
    }
  }

  const merged = dedupePosterUrls(posters.map((p) => p.url))
    .map((url) => posters.find((p) => p.url === url))
    .filter(Boolean)
    .filter((p) => p.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    posters: merged,
    bestPoster: merged[0]?.url || null,
    sourcesUsed,
    sourcesFailed,
  };
}

/* -----------------------------
   API HANDLER
----------------------------- */

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = parseInt(req.query.year) || null;

    const data = await findPosters(movie, year);

    res.status(200).json({
      movie,
      year,
      ...data,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
