/**
 * Find direct JPG/JPEG movie poster URLs using Firecrawl.
 *
 * Usage:
 *   FIRECRAWL_API_KEY=your_key node firecrawl-movie-posters.js "The Matrix"
 */

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";

/**
 * Search + crawl for movie posters and return top 5 JPG URLs.
 * @param {string} title
 * @returns {Promise<string[]>}
 */
async function getMoviePosters(title) {
  if (!title || !title.trim()) {
    throw new Error("A movie title is required.");
  }

  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("Missing FIRECRAWL_API_KEY.");
  }

  const query = `${title} movie poster`;
  const pagesToCheck = await searchMoviePages(query);

  if (!pagesToCheck.length) {
    return [];
  }

  const allCandidates = [];
  for (const pageUrl of pagesToCheck) {
    const html = await scrapeHtml(pageUrl);
    if (!html) continue;

    const imageUrls = extractImageUrls(html, pageUrl);
    for (const imageUrl of imageUrls) {
      if (isJpgUrl(imageUrl)) {
        allCandidates.push(imageUrl);
      }
    }
  }

  const ranked = rankPosterUrls(allCandidates);
  return ranked.slice(0, 5);
}

async function searchMoviePages(query) {
  try {
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
  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    return [];
  }
}

async function scrapeHtml(url) {
  try {
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
  } catch (error) {
    console.error(`Failed to scrape ${url}: ${error.message}`);
    return "";
  }
}

async function firecrawlRequest(path, options = {}) {
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
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2; // resolution hint in URL
  if (/vertical|large|original|hires/.test(lower)) score += 1;
  if (/thumb|small|icon|avatar/.test(lower)) score -= 2;

  return score;
}

function rankPosterUrls(urls) {
  const unique = [...new Set(urls)];
  return unique
    .map((url) => ({ url, score: posterScore(url) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);
}

module.exports = { getMoviePosters };

if (require.main === module) {
  (async () => {
    const title = process.argv.slice(2).join(" ");

    try {
      const posters = await getMoviePosters(title);
      if (!posters.length) {
        console.log(`No JPG posters found for \"${title}\".`);
        process.exitCode = 1;
        return;
      }

      console.log(JSON.stringify(posters, null, 2));
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  })();
}
