import fs from "fs";
import path from "path";
import FirecrawlApp from "@mendable/firecrawl-js";

const CACHE_DIR = path.resolve(".cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const DEFAULT_POSTER_COUNT = 5;
const MAX_POSTER_COUNT = 20;

function resolveRequestedPosterCount(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_POSTER_COUNT;
  return Math.min(MAX_POSTER_COUNT, Math.max(1, parsed));
}

function normalizeMovieTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imdbTitleMatchScore(candidateTitle, requestedTitle) {
  const candidate = normalizeMovieTitle(candidateTitle);
  if (!candidate || !requestedTitle) return 0;
  if (candidate === requestedTitle) return 6;
  if (candidate.startsWith(requestedTitle) || requestedTitle.startsWith(candidate)) return 4;
  if (candidate.includes(requestedTitle) || requestedTitle.includes(candidate)) return 2;
  return 0;
}

function isPosterImageUrl(url) {
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url);
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

function canonicalPosterKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname).replace(/\/+/g, "/").toLowerCase()}`;
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function dedupePosterUrls(urls) {
  const deduped = [];
  const seen = new Set();

  for (const url of urls) {
    const key = canonicalPosterKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(url);
  }

  return deduped;
}

function dedupePosterCandidatesByUrl(candidates) {
  const deduped = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const url = candidate?.imageUrl;
    if (typeof url !== "string") continue;

    const key = canonicalPosterKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function extractImageCandidates(result) {
  const urls = [];
  const items = Array.isArray(result?.data) ? result.data : [];

  for (const item of items) {
    if (typeof item?.url === "string") urls.push(item.url);

    const links = Array.isArray(item?.links) ? item.links : [];
    for (const link of links) {
      if (typeof link === "string") urls.push(link);
      else if (typeof link?.url === "string") urls.push(link.url);
      else if (typeof link?.href === "string") urls.push(link.href);
    }
  }

  return urls;
}

async function fetchImdbPosterCandidates(title) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) return [];
  const normalizedTitle = normalizeMovieTitle(trimmedTitle);

  const firstChar = trimmedTitle[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedTitle)}.json`;

  const response = await fetch(imdbUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const rankedCandidates = (payload?.d || [])
    .filter((item) => item?.id?.startsWith("tt"))
    .map((item) => ({
      imageUrl: item?.i?.imageUrl,
      matchScore: imdbTitleMatchScore(item?.l || item?.title, normalizedTitle),
    }))
    .filter((item) => item.matchScore > 0 && typeof item.imageUrl === "string")
    .sort((a, b) => (posterScore(b.imageUrl) + b.matchScore * 10) - (posterScore(a.imageUrl) + a.matchScore * 10));

  return dedupePosterCandidatesByUrl(rankedCandidates)
    .map((item) => item.imageUrl)
    .filter((url) => isPosterImageUrl(url));
}

export default async function handler(req, res) {
  try {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });
    const requestedCount = resolveRequestedPosterCount(req.query.count ?? req.query.limit);

    const safeFile = path.join(CACHE_DIR, `${title.toLowerCase()}.json`);

    if (fs.existsSync(safeFile)) {
      const data = JSON.parse(fs.readFileSync(safeFile, "utf-8"));
      return res.status(200).json({
        title: data.title || title,
        posters: Array.isArray(data.posters) ? data.posters.slice(0, requestedCount) : [],
        requestedCount,
        source: "cache",
      });
    }

    let posters = [];
    let source = "imdb";

    try {
      const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

      const result = await app.search(`${title} movie poster`, {
        limit: 8,
        scrapeOptions: { formats: ["links"] },
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
      posters = (await fetchImdbPosterCandidates(title)).slice(0, MAX_POSTER_COUNT);
      source = "imdb";
    }

    fs.writeFileSync(safeFile, JSON.stringify({ title, posters }));

    res.status(200).json({ title, posters: posters.slice(0, requestedCount), requestedCount, source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
