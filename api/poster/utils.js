export const POSTER_SEARCH_LIMIT = 10;

export function hasImageExtension(url) {
  return /\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(url);
}

export function isLikelyPosterImageUrl(url) {
  const lower = url.toLowerCase();

  if (hasImageExtension(lower)) return true;
  if (/\.(?:html?|php|aspx?|jsp)(?:$|[?#])/.test(lower)) return false;

  const hasImageQueryHint = /[?&](?:format|fm|ext|type|image_format)=(?:jpe?g|png|webp|avif)/.test(lower);
  const hasPosterHint = /(poster|cover|movie|theatrical|backdrop|artwork|tmdb|image|img)/.test(lower);
  return hasImageQueryHint || hasPosterHint;
}

export function posterScore(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/(poster|cover|movie|theatrical|artwork)/.test(lower)) score += 3;
  if (/tmdb|fanart|imdb/.test(lower)) score += 2;
  if (/image|img|cdn/.test(lower)) score += 1;
  if (/(\d{3,4})x(\d{3,4})/.test(lower)) score += 2;
  if (/(vertical|large|original|hires|full)/.test(lower)) score += 1;
  if (/(thumb|small|icon|avatar|logo|sprite)/.test(lower)) score -= 2;

  return score;
}

export function extractImageCandidates(result) {
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

export function pickTopPosterUrls(candidates, limit = 5) {
  const ranked = [...new Set(candidates)]
    .filter((url) => typeof url === "string" && url.startsWith("http"))
    .sort((a, b) => posterScore(b) - posterScore(a));

  const strictMatches = ranked.filter((url) => hasImageExtension(url));
  if (strictMatches.length >= limit) {
    return strictMatches.slice(0, limit);
  }

  const relaxedMatches = ranked.filter((url) => isLikelyPosterImageUrl(url));
  return relaxedMatches.slice(0, limit);
}
