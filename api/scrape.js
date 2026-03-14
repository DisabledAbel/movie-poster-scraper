import FirecrawlApp from "@mendable/firecrawl-js";

const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'`<>()\[\]{}]+?\.(?:jpe?g)(?:\?[^\s"'`<>()\[\]{}]+)?/gi;
const DEFAULT_POSTER_COUNT = 5;
const MAX_POSTER_COUNT = 20;

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
  if (/(imdb|tmdb|wikipedia|fanart|movieposterdb|theposterdb)/.test(lower)) score += 2;
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

function resolveRequestedPosterCount(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_POSTER_COUNT;
  return Math.min(MAX_POSTER_COUNT, Math.max(1, parsed));
}

async function fetchImdbPosterCandidates(movie) {
  const trimmedMovie = typeof movie === "string" ? movie.trim() : "";
  if (!trimmedMovie) return [];

  const firstChar = trimmedMovie[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedMovie)}.json`;

  const response = await fetch(imdbUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const candidates = (payload?.d || [])
    .filter((item) => item?.id?.startsWith("tt"))
    .map((item) => item?.i?.imageUrl)
    .filter((url) => typeof url === "string");

  return dedupePosterUrls(candidates)
    .filter((url) => isPosterImageUrl(url))
    .sort((a, b) => posterScore(b) - posterScore(a));
}

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const requestedCount = resolveRequestedPosterCount(req.query.count ?? req.query.limit);
    let posters = [];
    let source = "imdb";

    try {
      const app = new FirecrawlApp({
        apiKey: process.env.FIRECRAWL_API_KEY,
      });

      const result = await app.search(`${movie} movie poster`, {
        limit: 8,
        scrapeOptions: {
          formats: ["links", "markdown"],
        },
      });

      posters = dedupePosterUrls(extractImageCandidates(result))
        .filter((url) => isPosterImageUrl(url))
        .sort((a, b) => posterScore(b) - posterScore(a))
        .slice(0, MAX_POSTER_COUNT);

      source = "firecrawl";
    } catch {
      posters = [];
    }

    if (!posters.length) {
      posters = (await fetchImdbPosterCandidates(movie)).slice(0, MAX_POSTER_COUNT);
      source = "imdb";
    }

    res.status(200).json({
      movie,
      posters: posters.slice(0, requestedCount),
      requestedCount,
      source,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
