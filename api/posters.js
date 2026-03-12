const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";

async function firecrawlRequest(path, body) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Server is missing FIRECRAWL_API_KEY environment variable.");
  }

  const response = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl ${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

function extractImageUrls(html, baseUrl) {
  const regex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const urls = [];
  let match;

  while ((match = regex.exec(html)) !== null) {
    const src = match[1]?.trim();
    if (!src || src.startsWith("data:")) continue;

    try {
      urls.push(new URL(src, baseUrl).toString());
    } catch {
      // ignore malformed URL
    }
  }

  return urls;
}

function isJpgUrl(url) {
  return /\.jpe?g(?:$|[?#])/i.test(url);
}

function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie)/.test(lower)) score += 3;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;
  if (/vertical|large|original|hires/.test(lower)) score += 1;
  if (/thumb|small|icon|avatar/.test(lower)) score -= 2;

  return score;
}

function rankPosterUrls(urls) {
  return [...new Set(urls)]
    .map((url) => ({ url, score: posterScore(url) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.url);
}

async function getMoviePosters(title) {
  if (!title || !title.trim()) {
    throw new Error("A movie title is required.");
  }

  const query = `${title} movie poster`;
  const search = await firecrawlRequest("/search", { query, limit: 8 });
  const items = search?.data ?? search?.results ?? [];
  const pages = [...new Set(items.map((i) => i.url || i.link).filter((u) => typeof u === "string" && u.startsWith("http")))].slice(0, 5);

  const candidates = [];
  for (const pageUrl of pages) {
    try {
      const scraped = await firecrawlRequest("/scrape", { url: pageUrl, formats: ["html"] });
      const html = scraped?.data?.html || scraped?.data?.rawHtml || scraped?.html || scraped?.rawHtml || "";
      if (!html) continue;

      const imgs = extractImageUrls(html, pageUrl).filter(isJpgUrl);
      candidates.push(...imgs);
    } catch {
      // continue with other pages
    }
  }

  return rankPosterUrls(candidates).slice(0, 5);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const title = req.query?.title || "";
    const posters = await getMoviePosters(title);
    res.status(200).json({ posters });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
