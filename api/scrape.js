import FirecrawlApp from "@mendable/firecrawl-js";

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
      // Ignore malformed URLs.
    }
  }

  return urls;
}

function isImageUrl(url) {
  return /\.(jpe?g|png|webp)(?:$|[?#])/i.test(url);
}

function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie)/.test(lower)) score += 3;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;
  if (/vertical|large|original|hires/.test(lower)) score += 1;
  if (/thumb|small|icon|avatar|logo/.test(lower)) score -= 2;

  return score;
}

function rankPosterUrls(urls) {
  return [...new Set(urls)]
    .map((url) => ({ url, score: posterScore(url) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.url);
}

export default async function handler(req, res) {
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "FIRECRAWL_API_KEY is not configured." });
    }

    const app = new FirecrawlApp({ apiKey });
    const movie = (req.query.movie || "inception").toString().trim();

    if (!movie) {
      return res.status(400).json({ error: "Movie title is required." });
    }

    const searchResult = await app.search(`${movie} movie poster`, {
      limit: 8,
      scrapeOptions: { formats: ["links"] },
    });

    const candidates = searchResult?.data ?? [];
    const mappedUrls = candidates
      .map((item) => item?.url || item?.link)
      .filter((url) => typeof url === "string");

    const directImageUrls = mappedUrls.filter((url) => isImageUrl(url));
    const directImageUrlSet = new Set(directImageUrls);

    const pageUrls = mappedUrls
      .filter((url) => /^https?:\/\//.test(url) && !directImageUrlSet.has(url))
      .slice(0, 6);

    const scrapeResults = await Promise.allSettled(
      pageUrls.map((pageUrl) =>
        app.scrapeUrl(pageUrl, {
          formats: ["html"],
        }),
      ),
    );

    const scrapedImageUrls = scrapeResults.flatMap((result, index) => {
      if (result.status !== "fulfilled") {
        return [];
      }

      const pageUrl = pageUrls[index];
      const scraped = result.value;
      const html =
        scraped?.html ||
        scraped?.rawHtml ||
        scraped?.data?.html ||
        scraped?.data?.rawHtml ||
        "";

      if (!html) {
        return [];
      }

      return extractImageUrls(html, pageUrl).filter(isImageUrl);
    });

    const posters = rankPosterUrls([...directImageUrls, ...scrapedImageUrls]).slice(0, 5);

    return res.status(200).json({
      movie,
      posters,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
    });
  }
}
