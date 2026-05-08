const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'`<>()\[\]{}]+?\.(?:jpe?g)(?:\?[^\s"'`<>()\[\]{}]+)?/gi;

export function normalizeImageUrl(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/[),.;:!?]+$/g, "")
    .replace(/[\u201d\u2019]+$/g, "");
}

export function decodePossibleUrl(url) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export function looksLikeCleanImageUrl(url) {
  if (typeof url !== "string") return false;

  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/[\s<>{}[\]`]/.test(trimmed)) return false;

  const decoded = decodePossibleUrl(trimmed).toLowerCase();
  if (decoded.includes("[homepage]") || decoded.includes("add to favorites")) return false;
  if (/\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(trimmed) === false) return false;

  try {
    const parsed = new URL(trimmed);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    if (/\[(?:[^\]]*)\]|\((?:[^)]*)\)/.test(pathAndQuery)) return false;
    if (/%5b|%5d/i.test(pathAndQuery)) return false;
    if (pathAndQuery.length > 260) return false;
    return true;
  } catch {
    return false;
  }
}

export function isImageUrl(url) {
  return typeof url === "string" && /^https?:\/\/.+\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url.trim());
}

export function extractImageUrlsFromText(text) {
  if (typeof text !== "string") return [];
  const matches = text.match(IMAGE_URL_PATTERN) || [];
  return matches
    .map((url) => normalizeImageUrl(url))
    .filter((url) => looksLikeCleanImageUrl(url));
}

export function canonicalPosterKey(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = decodePossibleUrl(parsed.pathname).replace(/\/+/g, "/").toLowerCase();
    return `${hostname}${pathname}`;
  } catch {
    return normalizeImageUrl(url).toLowerCase();
  }
}

export function dedupePosterUrls(urls) {
  const deduped = [];
  const seenKeys = new Set();

  for (const url of urls) {
    const key = canonicalPosterKey(url);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(url);
  }

  return deduped;
}

export function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie|theatrical)/.test(lower)) score += 3;
  if (/(imdb|tmdb|wikipedia|fanart|movieposterdb|theposterdb|itunes|apple)/.test(lower)) score += 2;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;
  if (/(vertical|large|original|hires|full)/.test(lower)) score += 1;
  if (/(thumb|small|icon|avatar|logo|sprite|banner)/.test(lower)) score -= 2;
  if (lower.includes("image.tmdb.org")) score += 5;
  if (lower.includes("/original/")) score += 3;

  return score;
}

export function sortAndLimit(urls, min = 1, max = 15, filterFn = looksLikeCleanImageUrl) {
  const deduped = dedupePosterUrls(urls).filter((url) => filterFn(url));
  const sorted = deduped.sort((a, b) => posterScore(b) - posterScore(a));
  // If we have results, return up to max. If fewer than min, return what we have.
  if (sorted.length === 0) return [];
  return sorted.slice(0, max);
}

export function extractImageCandidates(result) {
  const urls = [];
  const seenObjects = new WeakSet();

  function visit(value) {
    if (!value) return;

    if (typeof value === "string") {
      urls.push(...extractImageUrlsFromText(value));
      if (looksLikeCleanImageUrl(value)) {
        urls.push(normalizeImageUrl(value));
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value === "object") {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);

      const directUrlFields = ["url", "href", "src", "image", "imageUrl"];
      for (const field of directUrlFields) {
        if (typeof value[field] === "string") {
          visit(value[field]);
        }
      }

      Object.values(value).forEach(visit);
    }
  }

  visit(result?.data ?? result);
  return urls;
}

export function normalizeYear(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsedYear = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 3000) {
    return null;
  }
  return parsedYear;
}

export function buildTmdbImageUrl(path, size) {
  if (typeof path !== "string") return "";
  const trimmedPath = path.trim();
  if (!trimmedPath) return "";

  const normalizedPath = trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
  return `https://image.tmdb.org/t/p/${size}${normalizedPath}`;
}

export function pickBestTmdbMatch(results, year) {
  if (!Array.isArray(results) || !results.length) return null;
  if (year === null) return results[0] || null;

  const scored = results
    .map((item) => {
      const releaseDate = typeof item?.release_date === "string" ? item.release_date : "";
      const releaseYear = Number.parseInt(releaseDate.slice(0, 4), 10);
      const yearDistance = Number.isInteger(releaseYear) ? Math.abs(releaseYear - year) : Number.POSITIVE_INFINITY;
      return { item, yearDistance };
    })
    .sort((a, b) => a.yearDistance - b.yearDistance);

  return scored[0]?.item || results[0] || null;
}

export function withTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}
