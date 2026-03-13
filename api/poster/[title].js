import fs from "fs";
import path from "path";
import FirecrawlApp from "@mendable/firecrawl-js";

const CACHE_DIR = path.resolve(".cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

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

async function fetchWikipediaPosterCandidates(title) {
  const query = encodeURIComponent(`${title} film`);
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=6&srsearch=${query}`;

  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) return [];

  const searchPayload = await searchResponse.json();
  const pageIds = (searchPayload?.query?.search || [])
    .map((item) => item?.pageid)
    .filter((id) => Number.isInteger(id));

  if (!pageIds.length) return [];

  const detailsUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages|images&piprop=original&pithumbsize=1000&imlimit=50&pageids=${pageIds.join("|")}`;
  const detailsResponse = await fetch(detailsUrl);
  if (!detailsResponse.ok) return [];

  const detailsPayload = await detailsResponse.json();
  const pages = detailsPayload?.query?.pages || {};
  const candidates = [];

  for (const page of Object.values(pages)) {
    const originalSource = page?.original?.source;
    if (typeof originalSource === "string") candidates.push(originalSource);

    const images = Array.isArray(page?.images) ? page.images : [];
    for (const image of images) {
      if (typeof image?.title !== "string") continue;
      if (!/\.(?:jpe?g)$/i.test(image.title)) continue;

      const fileTitle = image.title.replace(/^File:/i, "");
      candidates.push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileTitle)}`);
    }
  }

  return [...new Set(candidates)]
    .filter((url) => isPosterImageUrl(url))
    .sort((a, b) => posterScore(b) - posterScore(a));
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

    let posters = [];

    try {
      const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

      const result = await app.search(`${title} movie poster`, {
        limit: 8,
        scrapeOptions: { formats: ["links"] },
      });

      posters = [...new Set(extractImageCandidates(result))]
        .filter((url) => isPosterImageUrl(url))
        .sort((a, b) => posterScore(b) - posterScore(a))
        .slice(0, 5);
    } catch {
      posters = [];
    }

    if (!posters.length) {
      posters = (await fetchWikipediaPosterCandidates(title)).slice(0, 5);
    }

    fs.writeFileSync(safeFile, JSON.stringify({ title, posters }));

    res.status(200).json({ title, posters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
