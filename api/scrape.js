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

export default async function handler(req, res) {
  try {
    const app = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY,
    });

    const movie = req.query.movie || "inception";

    const result = await app.search(`${movie} movie poster`, {
      limit: 8,
      scrapeOptions: {
        formats: ["links", "markdown"],
      },
    });

    const posters = [...new Set(extractImageCandidates(result))]
      .filter((url) => isPosterImageUrl(url))
      .sort((a, b) => posterScore(b) - posterScore(a))
      .slice(0, 5);

    res.status(200).json({
      movie,
      posters,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
