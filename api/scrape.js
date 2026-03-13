import FirecrawlApp from "@mendable/firecrawl-js";

function isPosterImageUrl(url) {
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url);
}

function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie|theatrical)/.test(lower)) score += 3;
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

export default async function handler(req, res) {
  try {
    const app = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY,
    });

    const movie = req.query.movie || "inception";

    const result = await app.search(`${movie} movie poster`, {
      limit: 8,
      scrapeOptions: {
        formats: ["links"],
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
