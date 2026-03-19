import fs from "fs";
import path from "path";
import FirecrawlApp from "@mendable/firecrawl-js";

const CACHE_DIR = path.resolve(".cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

function isPosterImageUrl(url) {
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url);
}

function canonicalPosterKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname).toLowerCase()}`;
  } catch {
    return String(url || "").toLowerCase();
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

function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie|theatrical)/.test(lower)) score += 3;
  if (/(imdb|tmdb|wikipedia|fanart|movieposterdb|theposterdb|itunes|apple)/.test(lower)) score += 2;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;
  if (/(vertical|large|original|hires|full)/.test(lower)) score += 1;
  if (/(thumb|small|icon|avatar|logo)/.test(lower)) score -= 2;

  return score;
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

function sortAndLimit(urls, limit = 5) {
  return dedupePosterUrls(urls)
    .filter((url) => isPosterImageUrl(url))
    .sort((a, b) => posterScore(b) - posterScore(a))
    .slice(0, limit);
}

async function fetchFirecrawlPosterCandidates(title) {
  const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

  const result = await app.search(`${title} movie poster`, {
    limit: 8,
    scrapeOptions: { formats: ["links"] },
  });

  return sortAndLimit(extractImageCandidates(result));
}

async function fetchImdbPosterCandidates(title) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) return [];

  const firstChar = trimmedTitle[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedTitle)}.json`;

  const response = await fetch(imdbUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const candidates = (payload?.d || [])
    .filter((item) => item?.id?.startsWith("tt"))
    .map((item) => item?.i?.imageUrl)
    .filter((url) => typeof url === "string");

  return sortAndLimit(candidates);
}

async function fetchItunesPosterCandidates(title) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) return [];

  const query = encodeURIComponent(trimmedTitle);
  const iTunesUrl = `https://itunes.apple.com/search?term=${query}&media=movie&entity=movie&limit=25`;
  const response = await fetch(iTunesUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  const posters = (Array.isArray(payload?.results) ? payload.results : [])
    .map((item) => item?.artworkUrl100)
    .filter((url) => typeof url === "string")
    .map((url) => url.replace(/\/\d+x\d+bb\.(jpg|jpeg)$/i, "/1000x1000bb.$1"));

  return sortAndLimit(posters);
}

async function fetchWikipediaPosterCandidates(title) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) return [];

  const titleCandidates = [`${trimmedTitle} (film)`, trimmedTitle];

  for (const candidate of titleCandidates) {
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
    const response = await fetch(wikiUrl);
    if (!response.ok) continue;

    const payload = await response.json();
    const images = [payload?.originalimage?.source, payload?.thumbnail?.source].filter(
      (url) => typeof url === "string"
    );

    const posters = sortAndLimit(images);
    if (posters.length) return posters;
  }

  return [];
}

async function findPostersWithFallback(title) {
  const providers = [
    { name: "firecrawl", fetcher: () => fetchFirecrawlPosterCandidates(title) },
    { name: "imdb", fetcher: () => fetchImdbPosterCandidates(title) },
    { name: "itunes", fetcher: () => fetchItunesPosterCandidates(title) },
    { name: "wikipedia", fetcher: () => fetchWikipediaPosterCandidates(title) },
  ];

  const sourcesTried = [];
  for (const provider of providers) {
    sourcesTried.push(provider.name);
    try {
      const posters = await provider.fetcher();
      if (posters.length) {
        return { posters, source: provider.name, sourcesTried };
      }
    } catch {
      // continue through fallback chain
    }
  }

  return { posters: [], source: null, sourcesTried };
}

export default async function handler(req, res) {
  try {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });

    const safeFile = path.join(CACHE_DIR, `${title.toLowerCase()}.json`);

    if (fs.existsSync(safeFile)) {
      const data = JSON.parse(fs.readFileSync(safeFile, "utf-8"));
      return res.status(200).json(data);
    }

    const result = await findPostersWithFallback(title);
    const payload = { title, ...result };

    fs.writeFileSync(safeFile, JSON.stringify(payload));

    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
