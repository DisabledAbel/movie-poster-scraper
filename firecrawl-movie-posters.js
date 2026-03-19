/**
 * Find direct JPG/JPEG movie poster URLs.
 *
 * Usage:
 *   node firecrawl-movie-posters.js "The Matrix"
 *   node firecrawl-movie-posters.js "The Matrix" --save
 *   node firecrawl-movie-posters.js "The Matrix" --save --output ./posters/matrix.jpg
 *
 * Optional:
 *   FIRECRAWL_API_KEY=your_key node firecrawl-movie-posters.js "The Matrix"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";

/**
 * Search providers for movie posters and return top 5 JPG URLs.
 * Firecrawl is optional and used only when FIRECRAWL_API_KEY is set.
 * @param {string} title
 * @returns {Promise<string[]>}
 */
async function getMoviePosters(title) {
  if (!title || !title.trim()) {
    throw new Error("A movie title is required.");
  }

  const allCandidates = [];

  if (process.env.FIRECRAWL_API_KEY) {
    try {
      const firecrawlCandidates = await fetchFirecrawlPosterCandidates(title);
      allCandidates.push(...firecrawlCandidates);
    } catch (error) {
      console.error(`Firecrawl source failed: ${error.message}`);
    }
  }

  try {
    const imdbCandidates = await fetchImdbPosterCandidates(title);
    allCandidates.push(...imdbCandidates);
  } catch (error) {
    console.error(`IMDb source failed: ${error.message}`);
  }

  try {
    const itunesCandidates = await fetchItunesPosterCandidates(title);
    allCandidates.push(...itunesCandidates);
  } catch (error) {
    console.error(`iTunes source failed: ${error.message}`);
  }

  try {
    const wikipediaCandidates = await fetchWikipediaPosterCandidates(title);
    allCandidates.push(...wikipediaCandidates);
  } catch (error) {
    console.error(`Wikipedia source failed: ${error.message}`);
  }

  const ranked = rankPosterUrls(allCandidates);
  return ranked.slice(0, 5);
}

async function fetchFirecrawlPosterCandidates(title) {
  const query = `${title} movie poster`;
  const pagesToCheck = await searchMoviePages(query);
  if (!pagesToCheck.length) {
    return [];
  }

  const candidates = [];
  for (const pageUrl of pagesToCheck) {
    const html = await scrapeHtml(pageUrl);
    if (!html) continue;

    const imageUrls = extractImageUrls(html, pageUrl);
    for (const imageUrl of imageUrls) {
      if (isJpgUrl(imageUrl)) {
        candidates.push(imageUrl);
      }
    }
  }

  return candidates;
}

async function searchMoviePages(query) {
  const response = await firecrawlRequest("/search", {
    method: "POST",
    body: {
      query,
      limit: 8,
    },
  });

  const items = response?.data ?? response?.results ?? [];
  const urls = items
    .map((item) => item.url || item.link)
    .filter((url) => typeof url === "string" && url.startsWith("http"));

  return [...new Set(urls)].slice(0, 5);
}

async function scrapeHtml(url) {
  const response = await firecrawlRequest("/scrape", {
    method: "POST",
    body: {
      url,
      formats: ["html"],
    },
  });

  return (
    response?.data?.html ||
    response?.data?.rawHtml ||
    response?.html ||
    response?.rawHtml ||
    ""
  );
}

async function firecrawlRequest(path, options = {}) {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("Missing FIRECRAWL_API_KEY.");
  }

  const response = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl ${path} failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function fetchImdbPosterCandidates(title) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) return [];

  const firstChar = trimmedTitle[0].toLowerCase();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(trimmedTitle)}.json`;
  const response = await fetch(imdbUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  return (payload?.d || [])
    .filter((item) => item?.id?.startsWith("tt"))
    .map((item) => item?.i?.imageUrl)
    .filter((url) => typeof url === "string" && isJpgUrl(url));
}

async function fetchItunesPosterCandidates(title) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) return [];

  const query = encodeURIComponent(trimmedTitle);
  const iTunesUrl = `https://itunes.apple.com/search?term=${query}&media=movie&entity=movie&limit=25`;
  const response = await fetch(iTunesUrl);
  if (!response.ok) return [];

  const payload = await response.json();
  return (Array.isArray(payload?.results) ? payload.results : [])
    .map((item) => item?.artworkUrl100)
    .filter((url) => typeof url === "string")
    .map((url) => url.replace(/\/\d+x\d+bb\.(jpg|jpeg)$/i, "/1000x1000bb.$1"))
    .filter((url) => isJpgUrl(url));
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
    const candidates = [payload?.originalimage?.source, payload?.thumbnail?.source].filter(
      (url) => typeof url === "string" && isJpgUrl(url)
    );

    if (candidates.length) {
      return candidates;
    }
  }

  return [];
}

function extractImageUrls(html, baseUrl) {
  const imgSrcRegex = /<img\b[^>]*\bsrc=["']([^"'#?]+(?:\?[^"']*)?)["'][^>]*>/gi;
  const urls = [];
  let match;

  while ((match = imgSrcRegex.exec(html)) !== null) {
    const src = match[1]?.trim();
    if (!src || src.startsWith("data:")) continue;

    try {
      const absolute = new URL(src, baseUrl).toString();
      urls.push(absolute);
    } catch {
      // ignore malformed URLs
    }
  }

  return urls;
}

function isJpgUrl(url) {
  return /\.jpe?g(?:$|[?#])/i.test(url);
}

function posterScore(url) {
  let score = 0;
  const lower = url.toLowerCase();

  if (/(poster|cover|movie)/.test(lower)) score += 3;
  if (/(imdb|wikipedia|itunes|apple)/.test(lower)) score += 2;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2; // resolution hint in URL
  if (/vertical|large|original|hires/.test(lower)) score += 1;
  if (/thumb|small|icon|avatar/.test(lower)) score -= 2;

  return score;
}

function canonicalPosterKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname).toLowerCase()}`;
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function rankPosterUrls(urls) {
  const seen = new Set();
  const unique = [];

  for (const url of urls) {
    const key = canonicalPosterKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(url);
  }

  return unique
    .map((url) => ({ url, score: posterScore(url) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);
}

function sanitizeForFilename(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function defaultOutputPathFromTitle(title) {
  const safeTitle = sanitizeForFilename(title) || "movie-poster";
  return path.join(process.cwd(), `${safeTitle}.jpg`);
}

async function downloadPosterToFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}) from ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!/image\/jpe?g/i.test(contentType) && !isJpgUrl(url)) {
    throw new Error(`Downloaded file is not JPG/JPEG (content-type: ${contentType || "unknown"}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, buffer);

  return resolvedOutputPath;
}

function parseCliArgs(argv) {
  const options = {
    save: false,
    output: null,
    index: 0,
  };
  const titleParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--save") {
      options.save = true;
      continue;
    }

    if (token === "--output") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --output");
      }
      options.output = value;
      i += 1;
      continue;
    }

    if (token === "--index") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --index");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--index must be a non-negative integer");
      }
      options.index = parsed;
      i += 1;
      continue;
    }

    titleParts.push(token);
  }

  return {
    title: titleParts.join(" ").trim(),
    options,
  };
}

export { getMoviePosters };

const currentFilePath = fileURLToPath(import.meta.url);
const isExecutedDirectly = process.argv[1] && path.resolve(process.argv[1]) === currentFilePath;

if (isExecutedDirectly) {
  (async () => {
    try {
      const { title, options } = parseCliArgs(process.argv.slice(2));
      const posters = await getMoviePosters(title);

      if (!posters.length) {
        console.log(`No JPG posters found for \"${title}\".`);
        process.exitCode = 1;
        return;
      }

      if (options.save) {
        const selectedPoster = posters[options.index] || posters[0];
        const outputPath = options.output || defaultOutputPathFromTitle(title);
        const savedPath = await downloadPosterToFile(selectedPoster, outputPath);

        console.log(
          JSON.stringify(
            {
              title,
              posterUrl: selectedPoster,
              savedTo: savedPath,
            },
            null,
            2
          )
        );
        return;
      }

      console.log(JSON.stringify(posters, null, 2));
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  })();
}
