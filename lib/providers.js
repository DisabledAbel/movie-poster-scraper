import FirecrawlApp from "@mendable/firecrawl-js";
import {
  sortAndLimit,
  extractImageCandidates,
  buildTmdbImageUrl,
  pickBestTmdbMatch,
  isImageUrl,
  dedupePosterUrls,
  posterScore,
  looksLikeCleanImageUrl,
  withTimeout,
} from "./poster-utils.js";

export async function fetchTmdbPosterCandidates(movie, year) {
  const apiKey = process.env.TMDB_API_KEY;
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie || !apiKey) return [];

  try {
    const searchParams = new URLSearchParams({
      api_key: apiKey,
      query: trimmedMovie,
    });

    if (year !== null) {
      searchParams.set("year", String(year));
    }

    const tmdbSearchUrl = `https://api.themoviedb.org/3/search/movie?${searchParams.toString()}`;
    const response = await fetch(tmdbSearchUrl);
    if (!response.ok) return [];

    const payload = await response.json().catch(() => null);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const bestMatch = pickBestTmdbMatch(results, year);
    if (!bestMatch) return [];

    const prioritizedMatches = [bestMatch, ...results.filter((item) => item !== bestMatch)].slice(0, 3);

    const candidates = [];
    for (const match of prioritizedMatches) {
      const imagePaths = [match?.poster_path, match?.backdrop_path]
        .filter((path) => typeof path === "string" && path.trim());

      for (const path of imagePaths) {
        candidates.push(buildTmdbImageUrl(path, "w500"));
        candidates.push(buildTmdbImageUrl(path, "original"));
      }
    }

    return sortAndLimit(candidates);
  } catch {
    return [];
  }
}

export async function fetchTmdbSinglePoster(movie, year) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const searchParams = new URLSearchParams({ api_key: apiKey, query: movie });
    if (year !== null) searchParams.set("year", String(year));

    const response = await fetch(`https://api.themoviedb.org/3/search/movie?${searchParams.toString()}`);
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const best = pickBestTmdbMatch(results, year);
    const posterPath = best?.poster_path || best?.backdrop_path || "";

    if (!posterPath) return null;

    const image = buildTmdbImageUrl(posterPath, "w500");
    return isImageUrl(image) ? { image, source: "tmdb" } : null;
  } catch {
    return null;
  }
}

export async function fetchFirecrawlPosterCandidates(movie, year) {
  const app = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_API_KEY,
  });

  const searchQuery = year ? `${movie} ${year} movie poster` : `${movie} movie poster`;
  const result = await app.search(searchQuery, {
    limit: 8,
    scrapeOptions: {
      formats: ["links", "markdown"],
    },
  });

  return sortAndLimit(extractImageCandidates(result));
}

export async function fetchImdbPosterCandidates(movie, year) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const firstChar = trimmedMovie[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedMovie)}.json`;

  const response = await fetch(imdbUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const allItems = (payload?.d || []).filter((item) => item?.id?.startsWith("tt"));
  const normalizedSearch = trimmedMovie.toLowerCase();

  // If year is provided, filter to only movies from that year
  let filteredItems;
  if (year !== null) {
    filteredItems = allItems.filter((item) => item?.y === year);
  } else {
    filteredItems = allItems;
  }

  // Prioritize exact title matches
  const exactMatches = filteredItems.filter((item) => item?.l?.toLowerCase() === normalizedSearch);
  const prioritized = exactMatches.length
    ? exactMatches
    : filteredItems.slice(0, 15);

  const candidates = prioritized
    .map((item) => item?.i?.imageUrl)
    .filter((url) => typeof url === "string");

  return sortAndLimit(candidates);
}

export async function fetchImdbSinglePoster(movie, year) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return null;

  try {
    const firstChar = trimmedMovie[0].toLowerCase();
    const url = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedMovie)}.json`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload?.d) ? payload.d : [];

    const toYear = (value) => {
      const parsed = Number.parseInt(String(value || ""), 10);
      return Number.isInteger(parsed) ? parsed : null;
    };

    const prioritized = year === null
      ? items
      : [
          ...items.filter((item) => toYear(item?.y) === year),
          ...items.filter((item) => toYear(item?.y) !== year),
        ];

    const image = prioritized
      .map((item) => item?.i?.imageUrl)
      .find((candidate) => isImageUrl(candidate));

    return image ? { image, source: "imdb" } : null;
  } catch {
    return null;
  }
}

export async function fetchItunesPosterCandidates(movie, year) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const query = encodeURIComponent(trimmedMovie);
  const iTunesUrl = `https://itunes.apple.com/search?term=${query}&media=movie&entity=movie&limit=25`;
  const response = await fetch(iTunesUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];

  const filtered = results.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (year === null) return true;

    const releaseDate = typeof item.releaseDate === "string" ? item.releaseDate : "";
    const releaseYear = Number.parseInt(releaseDate.slice(0, 4), 10);
    return Number.isInteger(releaseYear) && releaseYear === year;
  });

  const selected = filtered.length ? filtered : results;

  const posters = selected
    .map((item) => item?.artworkUrl100)
    .filter((url) => typeof url === "string")
    .map((url) => url.replace(/\/\d+x\d+bb\.(jpg|jpeg)$/i, "/1000x1000bb.$1"));

  return sortAndLimit(posters);
}

export async function fetchWikipediaPosterCandidates(movie, year) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const titleCandidates = [
    year ? `${trimmedMovie} (${year} film)` : null,
    `${trimmedMovie} (film)`,
    trimmedMovie,
  ].filter(Boolean);

  for (const candidate of titleCandidates) {
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
    const response = await fetch(wikiUrl);
    if (!response.ok) continue;

    const payload = await response.json();
    const images = [payload?.originalimage?.source, payload?.thumbnail?.source].filter(
      (url) => typeof url === "string"
    );

    const posters = sortAndLimit(images);
    if (posters.length) {
      return posters;
    }
  }

  return [];
}

export function buildProviderChain(movie, year, options = {}) {
  const { includeTmdb = true, includeFirecrawl = true } = options;

  const providers = [];

  if (includeTmdb && process.env.TMDB_API_KEY) {
    providers.push({ name: "tmdb", fetcher: () => fetchTmdbPosterCandidates(movie, year) });
  }

  if (includeFirecrawl && process.env.FIRECRAWL_API_KEY) {
    providers.push({ name: "firecrawl", fetcher: () => fetchFirecrawlPosterCandidates(movie, year) });
  }

  providers.push(
    { name: "imdb", fetcher: () => fetchImdbPosterCandidates(movie, year) },
    { name: "itunes", fetcher: () => fetchItunesPosterCandidates(movie, year) },
    { name: "wikipedia", fetcher: () => fetchWikipediaPosterCandidates(movie, year) },
  );

  return providers;
}

export async function findPostersSequential(movie, year, options = {}) {
  const providers = buildProviderChain(movie, year, options);
  const sourcesTried = [];

  for (const provider of providers) {
    sourcesTried.push(provider.name);
    try {
      const posters = await provider.fetcher();
      if (posters.length) {
        return { posters, source: provider.name, sourcesTried };
      }
    } catch {
      // continue to next source
    }
  }

  return { posters: [], source: null, sourcesTried };
}

export async function findPostersParallel(movie, year, options = {}) {
  const providers = buildProviderChain(movie, year, options);

  const results = await Promise.allSettled(
    providers.map((p) =>
      withTimeout(
        p.fetcher()
          .then((posters) => ({ name: p.name, posters })),
        2500
      )
    )
  );

  const taggedPosters = [];
  const sourcesUsed = [];
  const sourcesFailed = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { name, posters } = result.value;
      if (posters.length) {
        for (const url of posters) {
          taggedPosters.push({ url, provider: name });
        }
        sourcesUsed.push(name);
      } else {
        sourcesFailed.push(name);
      }
    } else {
      sourcesFailed.push("unknown");
    }
  }

  const deduped = dedupePosterUrls(taggedPosters.map((p) => p.url));
  const posters = deduped
    .map((url) => {
      const tagged = taggedPosters.find((p) => p.url === url);
      const score = posterScore(url);
      return {
        url,
        score,
        confidence: Math.min(100, 50 + score * 10),
        provider: tagged?.provider || "unknown",
      };
    })
    .filter((p) => looksLikeCleanImageUrl(p.url))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { posters, sourcesUsed, sourcesFailed };
}
