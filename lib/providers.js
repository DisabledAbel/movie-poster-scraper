import FirecrawlApp from "@mendable/firecrawl-js";
import {
  buildTmdbImageUrl,
  pickBestTmdbMatch,
  isImageUrl,
  canonicalPosterKey,
  posterScore,
  movieRelevance,
  rankPosterCandidates,
  selectMatchingMovie,
  scopePosterCandidates,
  normalizeYear,
} from "./poster-utils.js";

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getProviderTimeoutMs(provider, options) {
  const configured = options.providerTimeoutMs ?? process.env.PROVIDER_TIMEOUT_MS;
  return provider.name === "firecrawl"
    ? positiveMilliseconds(options.firecrawlTimeoutMs ?? process.env.FIRECRAWL_TIMEOUT_MS ?? configured, 15000)
    : positiveMilliseconds(configured, 5000);
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

export async function fetchTmdbPosterCandidates(movie, year, { signal, timeoutMs } = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie || !apiKey) return [];
  const budgetMs = positiveMilliseconds(timeoutMs, 5000);
  const deadline = Date.now() + budgetMs;

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
    const bestMatch = pickBestTmdbMatch(results, year, trimmedMovie);
    if (!bestMatch) return [];
    const posterPaths = [bestMatch.poster_path].filter(Boolean);
    // The search thumbnail is only one design. Collect the selected movie's
    // poster gallery, excluding its backdrops and logos and other search hits.
    const remainingMs = deadline - Date.now() - Math.min(50, budgetMs / 5);
    if (Number.isSafeInteger(bestMatch.id) && bestMatch.id > 0 && remainingMs > 0) {
      try {
        const images = await runProviderWithDeadline(async ({ signal: gallerySignal }) => {
          const imagesUrl = `https://api.themoviedb.org/3/movie/${bestMatch.id}/images?${new URLSearchParams({ api_key: apiKey })}`;
          const imagesResponse = await fetch(imagesUrl, {
            signal: signal ? AbortSignal.any([signal, gallerySignal]) : gallerySignal,
          });
          return imagesResponse.ok ? await imagesResponse.json() : null;
        }, { timeoutMs: Math.min(2000, remainingMs) });
        if (images?.id === bestMatch.id && Array.isArray(images.posters)) {
          posterPaths.push(...images.posters.map((poster) => poster?.file_path));
        }
      } catch {
        // Preserve the search poster if the optional gallery fails or stalls.
      }
    }

    return rankPosterCandidates(posterPaths.map((path) => ({
      url: buildTmdbImageUrl(path, "original"),
      title: bestMatch.title,
      aliases: [bestMatch.original_title],
      year: normalizeYear(typeof bestMatch.release_date === "string" ? bestMatch.release_date.slice(0, 4) : null),
      movieId: bestMatch.id,
      provider: "tmdb",
      relevance: year === null ? 2 : 3,
    })));
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
    const best = pickBestTmdbMatch(results, year, movie);
    const posterPath = best?.poster_path || "";

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

  const searchQuery = year ? `"${movie}" ${year} movie poster gallery` : `"${movie}" movie poster gallery`;
  const result = await app.search(searchQuery, {
    limit: 8,
    ...(Number.isFinite(timeoutMs) ? { timeout: timeoutMs } : {}),
    scrapeOptions: {
      formats: ["extract"],
      onlyMainContent: false,
      extract: {
        prompt: `Extract all distinct direct movie poster image URLs for ${JSON.stringify(movie)}${year === null ? "" : ` released in ${year}`}, including alternate theatrical, teaser, character, and international designs shown in the gallery. Do not stop at the main poster. For each poster, use the actual movie title and original release year supported by the page. Do not guess missing details or relabel other movies. Exclude sequels, recommendations, backdrops, logos, and unrelated images. Return an empty posters array when the movie or image association cannot be verified.`,
        schema: {
          type: "object",
          required: ["posters"],
          properties: {
            posters: {
              type: "array",
              items: {
                type: "object",
                required: ["url", "title", "year"],
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  year: { type: "integer", minimum: 1888, maximum: 3000 },
                },
              },
            },
          },
        },
      },
    },
  });

  const pages = Array.isArray(result?.data) ? result.data : [];
  const candidates = pages.flatMap((page) => {
    const posters = page?.extract?.posters ?? page?.json?.posters;
    return Array.isArray(posters) ? posters : [];
  }).filter((poster) => normalizeYear(poster?.year) !== null && typeof poster?.title === "string")
    .map((poster) => ({
      url: poster.url,
      title: poster.title,
      year: normalizeYear(poster.year),
      provider: "firecrawl",
      relevance: movieRelevance(poster.title, poster.year, movie, year),
    }));

  // Page-wide links/markdown can include recommendations for other movies.
  return scopePosterCandidates(candidates, movie, year);
}

export async function fetchImdbPosterCandidates(movie, year, { signal } = {}) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const firstChar = trimmedMovie[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedMovie)}.json`;

  const response = await fetch(imdbUrl, { signal });
  if (!response.ok) return [];

  const payload = await response.json();
  const allItems = (Array.isArray(payload?.d) ? payload.d : [])
    .filter((item) => item?.id?.startsWith("tt"))
    .filter((item) => !item.qid || ["movie", "short", "tvMovie", "tvShort", "video"].includes(item.qid))
    .filter((item) => item.qid || !item.q || ["feature", "short", "TV movie", "TV short", "video"].includes(item.q));
  const candidates = allItems.map((item) => ({
    url: item?.i?.imageUrl,
    title: item?.l,
    year: normalizeYear(item?.y),
    movieId: item?.id,
    provider: "imdb",
    relevance: movieRelevance(item?.l, item?.y, trimmedMovie, year),
  }));

  const selected = selectMatchingMovie(candidates, trimmedMovie, year);
  return selected ? rankPosterCandidates([selected]) : [];
}

export async function fetchImdbSinglePoster(movie, year) {
  try {
    const image = (await fetchImdbPosterCandidates(movie, year))[0]?.url;
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

  const candidates = results.map((item) => ({
    url: typeof item?.artworkUrl100 === "string"
      ? item.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|jpeg)$/i, "/1000x1000bb.$1") : "",
    title: item?.trackName,
    year: normalizeYear(typeof item?.releaseDate === "string" ? item.releaseDate.slice(0, 4) : null),
    movieId: item?.trackId,
    provider: "itunes",
    relevance: movieRelevance(item?.trackName, typeof item?.releaseDate === "string" ? item.releaseDate.slice(0, 4) : null, movie, year),
  }));
  const selected = selectMatchingMovie(candidates, trimmedMovie, year);
  return selected ? rankPosterCandidates([selected]) : [];
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
    if (payload?.type === "disambiguation") continue;
    const pageTitle = typeof payload?.title === "string" ? payload.title : "";
    const description = typeof payload?.description === "string" ? payload.description : "";
    const intro = typeof payload?.extract === "string" ? payload.extract.slice(0, 300) : "";
    if (!/\bfilm\b/i.test(`${pageTitle} ${description} ${intro}`)) continue;
    const releaseYear = normalizeYear(pageTitle.match(/\((\d{4})\s+[^)]*film\)$/i)?.[1])
      ?? normalizeYear(description.match(/^(\d{4})\b[^.]*\bfilm\b/i)?.[1])
      ?? normalizeYear(intro.match(/\b(?:is|was)\s+(?:a|an)\s+(\d{4})\b[^.]*\bfilm\b/i)?.[1]);
    if (releaseYear === null) continue;
    const title = pageTitle.replace(/\s+\([^()]*film\)$/i, "");
    const images = [payload?.originalimage?.source, payload?.thumbnail?.source].filter(
      (url) => typeof url === "string"
    );

    const posters = scopePosterCandidates(images.map((url) => ({
      url,
      title,
      year: releaseYear,
      movieId: payload.wikibase_item ?? payload.pageid,
      provider: "wikipedia",
      relevance: movieRelevance(title, releaseYear, movie, year),
    })), movie, year);
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
    providers.push({ name: "tmdb", fetcher: (context) => fetchTmdbPosterCandidates(movie, context?.year ?? year, context) });
  }

  providers.push(
    { name: "imdb", fetcher: (context) => fetchImdbPosterCandidates(movie, context?.year ?? year, context) },
    { name: "itunes", fetcher: (context) => fetchItunesPosterCandidates(movie, context?.year ?? year, context) },
    { name: "wikipedia", fetcher: (context) => fetchWikipediaPosterCandidates(movie, context?.year ?? year, context) },
  );

  // Collect the fast fallbacks before spending the remaining budget on scraping.
  if (includeFirecrawl && process.env.FIRECRAWL_API_KEY) {
    providers.push({ name: "firecrawl", fetcher: (context) => fetchFirecrawlPosterCandidates(movie, context?.year ?? year, context) });
  }

  return providers;
}

function tagProviderPosters(posters, provider) {
  return (Array.isArray(posters) ? posters : []).map((poster) => typeof poster === "string"
    ? { url: poster, provider, relevance: 0 }
    : { ...poster, provider });
}

export async function findPostersSequential(movie, year, options = {}) {
  const providers = options.providers || buildProviderChain(movie, year, options);
  const overallTimeoutMs = positiveMilliseconds(
    options.overallTimeoutMs ?? process.env.POSTER_SEARCH_TIMEOUT_MS,
    25000,
  );
  const now = options.now || Date.now;
  const deadline = now() + overallTimeoutMs;
  const sourcesTried = [];

  // First, get IMDB poster candidates (includes "current" official poster)
  let imdbPosters = [];
  const imdbProvider = providers.find((provider) => provider.name === "imdb");
  try {
    if (imdbProvider && now() < deadline) {
      imdbPosters = await runProviderWithDeadline(imdbProvider.fetcher, {
        timeoutMs: Math.min(getProviderTimeoutMs(imdbProvider, options), deadline - now()),
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
      });
      imdbPosters = scopePosterCandidates(tagProviderPosters(imdbPosters, "imdb"), movie, year);
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
  let selectedYear = normalizeYear(year) ?? normalizeYear(imdbPosters[0]?.year);

  for (const provider of providers) {
    // Skip IMDB since we already fetched it to avoid duplicate network call
    if (provider.name === "imdb") continue;

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;

    sourcesTried.push(provider.name);
    try {
      const posters = await runProviderWithDeadline((context) => provider.fetcher({ ...context, year: selectedYear }), {
        timeoutMs: Math.min(getProviderTimeoutMs(provider, options), remainingMs),
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
      });
      if (posters.length) {
        const matching = scopePosterCandidates(tagProviderPosters(posters, provider.name), movie, selectedYear);
        selectedYear ??= normalizeYear(matching[0]?.year);
        // Keep metadata intact; final ranking also performs canonical deduplication.
        allPosters.push(...matching);
      }
    } catch {
      // continue to next source
    }
  }

  // If we have posters, put the first IMDB poster (current) first
  const sortedCandidates = scopePosterCandidates(allPosters, movie, selectedYear);
  const sortedPosters = sortedCandidates.map((candidate) => candidate.url);
  const currentPoster = scopePosterCandidates(imdbPosters, movie, selectedYear)[0]?.url;
  if (currentPoster) {
    const currentPosterKey = canonicalPosterKey(currentPoster);
    const filtered = sortedPosters.filter((url) => canonicalPosterKey(url) !== currentPosterKey);
    return {
      posters: [currentPoster, ...filtered].slice(0, 15),
      source: "imdb",
      sourcesTried,
    };
  }

  // No IMDB poster, return all sorted with the actual first source
  const posterKeys = new Set(sortedPosters.map(canonicalPosterKey));
  const firstSource = allPosters.find((candidate) => posterKeys.has(canonicalPosterKey(candidate.url)))?.provider || null;
  return {
    posters: sortedPosters,
    source: firstSource,
    sourcesTried,
  };
}

export async function findPostersParallel(movie, year, options = {}) {
  const providers = options.providers || buildProviderChain(movie, year, options);
  const overallTimeoutMs = positiveMilliseconds(
    options.overallTimeoutMs ?? process.env.POSTER_SEARCH_TIMEOUT_MS,
    25000,
  );

  const results = await Promise.allSettled(
    providers.map((p) =>
      runProviderWithDeadline(p.fetcher, {
        timeoutMs: Math.min(getProviderTimeoutMs(p, options), overallTimeoutMs),
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
      }).then((posters) => ({ name: p.name, posters }))
    )
  );

  const taggedPosters = [];
  const sourcesUsed = [];
  const sourcesFailed = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { name, posters } = result.value;
      if (posters.length) {
        taggedPosters.push(...tagProviderPosters(posters, name));
        sourcesUsed.push(name);
      } else {
        sourcesFailed.push(name);
      }
    } else {
      sourcesFailed.push("unknown");
    }
  }

  const posters = scopePosterCandidates(taggedPosters, movie, year)
    .map((tagged) => {
      const score = posterScore(tagged.url);
      return {
        url: tagged.url,
        score,
        confidence: Math.min(100, 50 + score * 10),
        provider: tagged.provider || "unknown",
      };
    });

  const contributingSources = new Set(posters.map((poster) => poster.provider));
  return {
    posters,
    sourcesUsed: sourcesUsed.filter((name) => contributingSources.has(name)),
    sourcesFailed: [...sourcesFailed, ...sourcesUsed.filter((name) => !contributingSources.has(name))],
  };
}
