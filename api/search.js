function toYear(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) ? parsed : null;
}


function parseQueryAndYear(rawQuery, rawYear) {
  const cleanQuery = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const explicitYear = toYear(rawYear);
  if (!cleanQuery) return { query: "", year: explicitYear };

  const match = cleanQuery.match(/^(.*)\((\d{4})\)\s*$/);
  if (!match) return { query: cleanQuery, year: explicitYear };

  const titleOnly = match[1].trim();
  const parsedYear = toYear(match[2]);
  return {
    query: titleOnly || cleanQuery,
    year: explicitYear ?? parsedYear,
  };
}

function buildTmdbPosterUrl(posterPath) {
  const raw = typeof posterPath === "string" ? posterPath.trim() : "";
  if (!raw) return "";
  const normalized = raw.startsWith("/") ? raw.slice(1) : raw;
  return `https://image.tmdb.org/t/p/w500/${normalized}`;
}

function isImageUrl(url) {
  return typeof url === "string" && /^https?:\/\/.+\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url.trim());
}

function pickBestTmdbResult(results, year) {
  if (!Array.isArray(results) || !results.length) return null;
  if (year === null) return results[0] || null;

  return (
    results
      .map((item) => {
        const y = toYear((item?.release_date || "").slice(0, 4));
        return {
          item,
          delta: y === null ? Number.POSITIVE_INFINITY : Math.abs(y - year),
        };
      })
      .sort((a, b) => a.delta - b.delta)[0]?.item || results[0]
  );
}

async function fetchTmdbPoster(query, year) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({ api_key: apiKey, query });
    if (year !== null) params.set("year", String(year));

    const response = await fetch(`https://api.themoviedb.org/3/search/movie?${params.toString()}`);
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const best = pickBestTmdbResult(payload?.results || [], year);
    const image = buildTmdbPosterUrl(best?.poster_path || best?.backdrop_path || "");

    return isImageUrl(image) ? { image, source: "tmdb" } : null;
  } catch {
    return null;
  }
}

async function fetchImdbPoster(query, year) {
  const clean = query.trim();
  if (!clean) return null;

  try {
    const firstChar = clean[0].toLowerCase();
    const url = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(clean)}.json`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload?.d) ? payload.d : [];

    const prioritized = year === null
      ? items
      : [
          ...items.filter((item) => toYear(item?.y) === year),
          ...items.filter((item) => toYear(item?.y) !== year),
        ];

    const image = prioritized
      .map((item) => item?.i?.imageUrl)
      .find((candidate) => isImageUrl(candidate));

    return image ? { image, source: "imdb" } : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const parsed = parseQueryAndYear(req.query?.query, req.query?.year);
    const query = parsed.query;
    const year = parsed.year;

    if (!query) {
      return res.status(400).json({ error: "Missing query parameter: query" });
    }

    const tmdb = await fetchTmdbPoster(query, year);
    if (tmdb) {
      return res.status(200).json({ query, image: tmdb.image, source: tmdb.source });
    }

    const imdb = await fetchImdbPoster(query, year);
    if (imdb) {
      return res.status(200).json({ query, image: imdb.image, source: imdb.source });
    }

    return res.status(404).json({ query, error: "No image found" });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}
