import FirecrawlApp from "@mendable/firecrawl-js";
import {
  sortAndLimit,
  extractImageCandidates,
  buildTmdbImageUrl,
  pickBestTmdbMatch,
  isImageUrl,
  posterScore,
  movieRelevance,
  rankPosterCandidates,
  withTimeout,
} from "./poster-utils.js";

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function runProviderWithDeadline(fetcher, {
  timeoutMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const controller = new AbortController();
  const delay = positiveMilliseconds(timeoutMs, 1);
  let timer;

  const providerPromise = Promise.resolve().then(() => fetcher({
    signal: controller.signal,
    timeoutMs: delay,
  }));

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimer(() => {
      controller.abort();
      reject(new Error("Provider timed out"));
    }, delay);
  });

  // Promise.race installs handlers on both promises, so a provider that settles
  // after its timeout cannot create an unhandled rejection.
  return Promise.race([providerPromise, timeoutPromise]).finally(() => {
    clearTimer(timer);
  });
}

export async function fetchTmdbPosterCandidates(movie, year, { signal } = {}) {
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
    const response = await fetch(tmdbSearchUrl, { signal });
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

export async function fetchFirecrawlPosterCandidates(movie, year, { timeoutMs } = {}) {
  const app = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_API_KEY,
  });

  const searchQuery = year ? `${movie} ${year} movie poster` : `${movie} movie poster`;
  const result = await app.search(searchQuery, {
    limit: 8,
    ...(Number.isFinite(timeoutMs) ? { timeout: timeoutMs } : {}),
    scrapeOptions: {
      formats: ["links", "markdown"],
    },
  });

  return sortAndLimit(extractImageCandidates(result));
}

export async function fetchImdbPosterCandidates(movie, year, { signal } = {}) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const firstChar = trimmedMovie[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedMovie)}.json`;

  const response = await fetch(imdbUrl, { signal });
  if (!response.ok) return [];

  const payload = await response.json();
  const allItems = (payload?.d || []).filter((item) => item?.id?.startsWith("tt"));
  // If year is provided, filter to only movies from that year
  let filteredItems;
  if (year !== null) {
    const yearNum = Number.parseInt(year, 10);
    filteredItems = allItems.filter((item) => item?.y === yearNum);
  } else {
    filteredItems = allItems;
  }

  const candidates = filteredItems.map((item) => ({
    url: item?.i?.imageUrl,
    title: item?.l,
    year: item?.y,
    provider: "imdb",
    relevance: movieRelevance(item?.l, item?.y, trimmedMovie, year),
  }));

  return rankPosterCandidates(candidates);
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

export async function fetchItunesPosterCandidates(movie, year, { signal } = {}) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const query = encodeURIComponent(trimmedMovie);
  const iTunesUrl = `https://itunes.apple.com/search?term=${query}&media=movie&entity=movie&limit=25`;
  const response = await fetch(iTunesUrl, { signal });
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

export async function fetchWikipediaPosterCandidates(movie, year, { signal } = {}) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const titleCandidates = [
    year ? `${trimmedMovie} (${year} film)` : null,
    `${trimmedMovie} (film)`,
    trimmedMovie,
  ].filter(Boolean);

  for (const candidate of titleCandidates) {
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
    const response = await fetch(wikiUrl, { signal });
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
    providers.push({ name: "tmdb", fetcher: (context) => fetchTmdbPosterCandidates(movie, year, context) });
  }

  if (includeFirecrawl && process.env.FIRECRAWL_API_KEY) {
    providers.push({ name: "firecrawl", fetcher: (context) => fetchFirecrawlPosterCandidates(movie, year, context) });
  }

  providers.push(
    { name: "imdb", fetcher: (context) => fetchImdbPosterCandidates(movie, year, context) },
    { name: "itunes", fetcher: (context) => fetchItunesPosterCandidates(movie, year, context) },
    { name: "wikipedia", fetcher: (context) => fetchWikipediaPosterCandidates(movie, year, context) },
  );

  return providers;
}

export async function findPostersSequential(movie, year, options = {}) {
  const providers = options.providers || buildProviderChain(movie, year, options);
  const providerTimeoutMs = positiveMilliseconds(
    options.providerTimeoutMs ?? process.env.PROVIDER_TIMEOUT_MS,
    5000,
  );
  const overallTimeoutMs = positiveMilliseconds(
    options.overallTimeoutMs ?? process.env.POSTER_SEARCH_TIMEOUT_MS,
    25000,
  );
  const now = options.now || Date.now;
  const deadline = now() + overallTimeoutMs;
  const sourcesTried = [];

  // Track the first provider that actually contributed posters
  let firstSource = null;

  // First, get IMDB poster candidates (includes "current" official poster)
  let imdbPosters = [];
  const imdbProvider = providers.find((provider) => provider.name === "imdb");
  try {
    if (imdbProvider && now() < deadline) {
      imdbPosters = await runProviderWithDeadline(imdbProvider.fetcher, {
        timeoutMs: Math.min(providerTimeoutMs, deadline - now()),
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
      });
    }
    if (imdbPosters.length > 0) {
      firstSource = "imdb";
    }
  } catch {
    // continue
  }

  // Then try all providers to get additional posters
  const allPosters = [];

  // Add IMDB posters first (if available)
  for (const candidate of imdbPosters) {
    allPosters.push(candidate);
  }

  for (const provider of providers) {
    // Skip IMDB since we already fetched it to avoid duplicate network call
    if (provider.name === "imdb") continue;

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;

    sourcesTried.push(provider.name);
    try {
      const posters = await runProviderWithDeadline(provider.fetcher, {
        timeoutMs: Math.min(providerTimeoutMs, remainingMs),
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
      });
      if (posters.length) {
        // Track first provider that contributed posters
        if (firstSource === null) {
          firstSource = provider.name;
        }
        // Keep metadata intact; final ranking also performs canonical deduplication.
        allPosters.push(...posters);
      }
    } catch {
      // continue to next source
    }
  }

  // If we have posters, put the first IMDB poster (current) first
  const sortedCandidates = rankPosterCandidates(allPosters);
  const sortedPosters = sortedCandidates.map((candidate) => candidate.url);
  if (imdbPosters.length > 0) {
    const currentPoster = imdbPosters[0].url ?? imdbPosters[0];
    const filtered = sortedPosters.filter((url) => url !== currentPoster);
    return {
      posters: [currentPoster, ...filtered],
      source: "imdb",
      sourcesTried,
    };
  }

  // No IMDB poster, return all sorted with the actual first source
  return {
    posters: sortedPosters,
    source: firstSource,
    sourcesTried,
  };
}

export async function findPostersParallel(movie, year, options = {}) {
  const providers = options.providers || buildProviderChain(movie, year, options);

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
        for (const poster of posters) {
          taggedPosters.push(typeof poster === "string"
            ? { url: poster, provider: name, relevance: 0 }
            : { ...poster, provider: poster.provider || name });
        }
        sourcesUsed.push(name);
      } else {
        sourcesFailed.push(name);
      }
    } else {
      sourcesFailed.push("unknown");
    }
  }

  const posters = rankPosterCandidates(taggedPosters)
    .map((tagged) => {
      const score = posterScore(tagged.url);
      return {
        url: tagged.url,
        score,
        confidence: Math.min(100, 50 + score * 10),
        provider: tagged.provider || "unknown",
      };
    });

  return { posters, sourcesUsed, sourcesFailed };
}
