import FirecrawlApp from "@mendable/firecrawl-js";

const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'`<>()\[\]{}]+?\.(?:jpe?g)(?:\?[^\s"'`<>()\[\]{}]+)?/gi;

function normalizeImageUrl(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/[),.;:!?]+$/g, "")
    .replace(/[\u201d\u2019]+$/g, "");
}

function decodePossibleUrl(url) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function looksLikeCleanImageUrl(url) {
  if (typeof url !== "string") return false;

  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/[\s<>{}[\]`]/.test(trimmed)) return false;

  const decoded = decodePossibleUrl(trimmed).toLowerCase();
  if (decoded.includes("[homepage]") || decoded.includes("add to favorites")) return false;
  if (/\.(?:jpe?g)(?:$|[?#])/i.test(trimmed) === false) return false;

  try {
    const parsed = new URL(trimmed);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    if (/\[(?:[^\]]*)\]|\((?:[^)]*)\)/.test(pathAndQuery)) return false;
    if (/%5b|%5d/i.test(pathAndQuery)) return false;
    if (pathAndQuery.length > 260) return false;
    return true;
  } catch {
    return false;
  }
}

function extractImageUrlsFromText(text) {
  if (typeof text !== "string") return [];
  const matches = text.match(IMAGE_URL_PATTERN) || [];
  return matches
    .map((url) => normalizeImageUrl(url))
    .filter((url) => looksLikeCleanImageUrl(url));
}

function isPosterImageUrl(url) {
  return looksLikeCleanImageUrl(url);
}

function canonicalPosterKey(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = decodePossibleUrl(parsed.pathname).replace(/\/+/g, "/").toLowerCase();
    return `${hostname}${pathname}`;
  } catch {
    return normalizeImageUrl(url).toLowerCase();
  }
}

function dedupePosterUrls(urls) {
  const deduped = [];
  const seenKeys = new Set();

  for (const url of urls) {
    const key = canonicalPosterKey(url);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(url);
  }

  return deduped;
}

function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie|theatrical)/.test(lower)) score += 3;
  if (/(imdb|tmdb|wikipedia|fanart|movieposterdb|theposterdb|itunes|apple)/.test(lower)) score += 2;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;
  if (/(vertical|large|original|hires|full)/.test(lower)) score += 1;
  if (/(thumb|small|icon|avatar|logo|sprite|banner)/.test(lower)) score -= 2;

  return score;
}

function extractImageCandidates(result) {
  const urls = [];
  const seenObjects = new WeakSet();

  function visit(value) {
    if (!value) return;

    if (typeof value === "string") {
      urls.push(...extractImageUrlsFromText(value));
      if (isPosterImageUrl(value)) {
        urls.push(normalizeImageUrl(value));
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === "object") {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);

      const directUrlFields = ["url", "href", "src", "image", "imageUrl"];
      for (const field of directUrlFields) {
        if (typeof value[field] === "string") {
          visit(value[field]);
        }
      }

      Object.values(value).forEach(visit);
    }
  }

  visit(result?.data ?? result);
  return urls;
}

function normalizeYear(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsedYear = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 3000) {
    return null;
  }

  return parsedYear;
}

function sortAndLimit(urls, limit = 5) {
  return dedupePosterUrls(urls)
    .filter((url) => isPosterImageUrl(url))
    .sort((a, b) => posterScore(b) - posterScore(a))
    .slice(0, limit);
}

async function fetchFirecrawlPosterCandidates(movie, year) {
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

async function fetchImdbPosterCandidates(movie, year) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const firstChar = trimmedMovie[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedMovie)}.json`;

  const response = await fetch(imdbUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const allCandidates = (payload?.d || [])
    .filter((item) => item?.id?.startsWith("tt"))
    .filter((item) => year === null || item?.y === year)
    .map((item) => item?.i?.imageUrl)
    .filter((url) => typeof url === "string");

  const candidates = allCandidates.length
    ? allCandidates
    : (payload?.d || [])
        .filter((item) => item?.id?.startsWith("tt"))
        .map((item) => item?.i?.imageUrl)
        .filter((url) => typeof url === "string");

  return sortAndLimit(candidates);
}

async function fetchItunesPosterCandidates(movie, year) {
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

async function fetchWikipediaPosterCandidates(movie, year) {
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

async function findPostersWithFallback(movie, year) {
  const providers = [
    { name: "firecrawl", fetcher: () => fetchFirecrawlPosterCandidates(movie, year) },
    { name: "imdb", fetcher: () => fetchImdbPosterCandidates(movie, year) },
    { name: "itunes", fetcher: () => fetchItunesPosterCandidates(movie, year) },
    { name: "wikipedia", fetcher: () => fetchWikipediaPosterCandidates(movie, year) },
  ];

  const sourcesTried = [];
  for (const provider of providers) {
    sourcesTried.push(provider.name);
    try {
      const posters = await provider.fetcher();
      if (posters.length) {
        return {
          posters,
          source: provider.name,
          sourcesTried,
        };
      }
    } catch {
      // continue to next source
    }
  }

  return {
    posters: [],
    source: null,
    sourcesTried,
  };
}

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, source, sourcesTried } = await findPostersWithFallback(movie, year);

    res.status(200).json({
      movie,
      year,
      posters,
      source,
      sourcesTried,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
