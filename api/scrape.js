import FirecrawlApp from "@mendable/firecrawl-js";

/* -----------------------------
   URL + IMAGE VALIDATION
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
  return value
    .trim()
    .replace(/[),.;:!?]+$/g, "")
    .replace(/[\u201d\u2019]+$/g, "");
}

function looksLikeCleanImageUrl(url) {
  if (typeof url !== "string") return false;

  const trimmed = normalizeImageUrl(url);
  if (!/^https?:\/\//i.test(trimmed)) return false;

  const parsed = safeParseUrl(trimmed);
  if (!parsed) return false;

  const full = `${parsed.pathname}${parsed.search}`.toLowerCase();

  if (!/\.(jpe?g)(?:$|[?#])/.test(full)) return false;
  if (/[<>{}[\]`]/.test(full)) return false;
  if (/%5b|%5d/.test(full)) return false;
  if (full.length > 260) return false;

  return true;
}

/* -----------------------------
   EXTRACTION
----------------------------- */

const IMAGE_URL_PATTERN =
  /https?:\/\/[^\s"'`<>()\[\]{}]+?\.(?:jpe?g)(?:\?[^\s"'`<>()\[\]{}]+)?/gi;

function extractImageUrlsFromText(text) {
  if (typeof text !== "string") return [];
  const matches = text.match(IMAGE_URL_PATTERN) || [];
  return matches.map(normalizeImageUrl);
}

function extractImageCandidates(result) {
  const urls = [];
  const seenObjects = new WeakSet();

  function visit(value) {
    if (!value) return;

    if (typeof value === "string") {
      urls.push(...extractImageUrlsFromText(value));
      urls.push(normalizeImageUrl(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === "object") {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);

      ["url", "href", "src", "image", "imageUrl"].forEach((key) => {
        if (typeof value[key] === "string") visit(value[key]);
      });

      Object.values(value).forEach(visit);
    }
  }

  visit(result?.data ?? result);
  return urls;
}

/* -----------------------------
   DEDUPE + SCORING
----------------------------- */

function canonicalPosterKey(url) {
  const parsed = safeParseUrl(url);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.replace(/\/+/g, "/").toLowerCase();
  return `${hostname}${pathname}`;
}

function dedupePosterUrls(urls) {
  const seen = new Set();
  const output = [];

  for (const url of urls) {
    const key = canonicalPosterKey(url);
    if (!key) continue;

    if (!seen.has(key)) {
      seen.add(key);
      output.push(url);
    }
  }

  return output;
}

function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|theatrical)/.test(lower)) score += 4;
  if (/(imdb|tmdb|itunes|apple|fanart|posterdb)/.test(lower)) score += 3;

  const resMatch = lower.match(/(\d{3,4})x(\d{3,4})/);
  if (resMatch) {
    const h = parseInt(resMatch[2]);
    if (h >= 1000) score += 3;
    else if (h >= 500) score += 2;
  }

  if (/(original|large|hires)/.test(lower)) score += 2;

  if (/(thumb|small|icon|logo|avatar|sprite|banner)/.test(lower)) score -= 4;

  return score;
}

function buildPosterObjects(urls) {
  return urls.map((url) => {
    const score = posterScore(url);
    return {
      url,
      score,
      confidence: Math.min(100, 50 + score * 10),
    };
  });
}

function sortAndLimit(urls, limit = 5) {
  const valid = dedupePosterUrls(urls).filter(looksLikeCleanImageUrl);

  return buildPosterObjects(valid)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* -----------------------------
   UTIL
----------------------------- */

function normalizeYear(value) {
  if (!value) return null;
  const y = parseInt(value, 10);
  return y >= 1888 && y <= 3000 ? y : null;
}

/* -----------------------------
   PROVIDERS
----------------------------- */

async function fetchFirecrawlPosterCandidates(movie, year) {
  const app = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_API_KEY,
  });

  const query = year
    ? `${movie} ${year} movie poster`
    : `${movie} movie poster`;

  const result = await app.search(query, {
    limit: 8,
    scrapeOptions: { formats: ["links", "markdown"] },
  });

  return sortAndLimit(extractImageCandidates(result));
}

async function fetchImdbPosterCandidates(movie, year) {
  const name = movie?.trim();
  if (!name) return [];

  const url = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(
    name[0].toLowerCase()
  )}/${encodeURIComponent(name)}.json`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();

  const items = (data?.d || [])
    .filter((x) => x?.id?.startsWith("tt"))
    .filter((x) => (year ? x?.y === year : true))
    .map((x) => x?.i?.imageUrl)
    .filter(Boolean);

  return sortAndLimit(items);
}

async function fetchItunesPosterCandidates(movie, year) {
  const name = movie?.trim();
  if (!name) return [];

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    name
  )}&media=movie&limit=25`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();

  const items = (data?.results || [])
    .filter((x) => {
      if (!year) return true;
      const y = parseInt(x?.releaseDate?.slice(0, 4));
      return y === year;
    })
    .map((x) =>
      x?.artworkUrl100?.replace(
        /\/\d+x\d+bb\.(jpg|jpeg)$/i,
        "/1000x1000bb.$1"
      )
    )
    .filter(Boolean);

  return sortAndLimit(items);
}

async function fetchWikipediaPosterCandidates(movie, year) {
  const name = movie?.trim();
  if (!name) return [];

  const attempts = [
    year ? `${name} (${year} film)` : null,
    `${name} (film)`,
    name,
  ].filter(Boolean);

  for (const title of attempts) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title
    )}`;

    const res = await fetch(url);
    if (!res.ok) continue;

    const data = await res.json();

    const images = [
      data?.originalimage?.source,
      data?.thumbnail?.source,
    ].filter(Boolean);

    const posters = sortAndLimit(images);
    if (posters.length) return posters;
  }

  return [];
}

/* -----------------------------
   MAIN LOGIC
----------------------------- */

async function findPosters(movie, year) {
  const providers = [
    { name: "firecrawl", fn: fetchFirecrawlPosterCandidates },
    { name: "imdb", fn: fetchImdbPosterCandidates },
    { name: "itunes", fn: fetchItunesPosterCandidates },
    { name: "wikipedia", fn: fetchWikipediaPosterCandidates },
  ];

  const tried = [];

  for (const p of providers) {
    tried.push(p.name);
    try {
      const posters = await p.fn(movie, year);
      if (posters.length) {
        return { posters, source: p.name, sourcesTried: tried };
      }
    } catch (err) {
      console.error(p.name, err);
    }
  }

  return { posters: [], source: null, sourcesTried: tried };
}

/* -----------------------------
   API HANDLER
----------------------------- */

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const year = normalizeYear(req.query.year);

    const { posters, source, sourcesTried } = await findPosters(
      movie,
      year
    );

    res.status(200).json({
      movie,
      year,
      posters,
      bestPoster: posters[0]?.url || null,
      source,
      sourcesTried,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
