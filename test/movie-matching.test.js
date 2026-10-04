import assert from "node:assert/strict";
import test from "node:test";
import FirecrawlApp from "@mendable/firecrawl-js";

import {
  fetchFirecrawlPosterCandidates,
  fetchImdbPosterCandidates,
  fetchImdbSinglePoster,
  fetchItunesPosterCandidates,
  fetchTmdbPosterCandidates,
  fetchTmdbSinglePoster,
  fetchWikipediaPosterCandidates,
  findPostersParallel,
  findPostersSequential,
} from "../lib/providers.js";
import { getMoviePosters } from "../firecrawl-movie-posters.js";

const image = (name) => `https://images.example.com/${name}.jpg`;
const urls = (candidates) => candidates.map((candidate) => typeof candidate === "string" ? candidate : candidate.url);
const imdbMovie = (id, title, year, name = id) => ({ id, l: title, y: year, qid: "movie", i: { imageUrl: image(name) } });
const itunesMovie = (id, title, year) => ({ trackId: id, trackName: title, releaseDate: `${year}-01-01T00:00:00Z`, artworkUrl100: image(String(id)) });

function mockFetch(t, payload) {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => payload }));
}

function setEnv(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("IMDb excludes sequels and unrelated titles from the entire result list", async (t) => {
  mockFetch(t, { d: [
    imdbMovie("tt2", "Frozen II", 2019, "large-original-poster"),
    imdbMovie("tt1", "Frozen", 2013),
    imdbMovie("tt3", "Frozen River", 2008),
  ] });
  assert.deepEqual(urls(await fetchImdbPosterCandidates("frozen", null)), [image("tt1")]);
});

test("IMDb selects one release when identical titles have different years", async (t) => {
  mockFetch(t, { d: [imdbMovie("tt1", "The Thing", 1982), imdbMovie("tt2", "The Thing", 2011)] });
  assert.deepEqual(urls(await fetchImdbPosterCandidates("The Thing", null)), [image("tt1")]);
});

test("title normalization tolerates punctuation while preserving sequel numbers", async (t) => {
  mockFetch(t, { d: [
    imdbMovie("tt2", "Spider-Man 2", 2004),
    imdbMovie("tt1", "Spider-Man", 2002),
  ] });
  assert.deepEqual(urls(await fetchImdbPosterCandidates("  SPIDER MAN  ", null)), [image("tt1")]);
  assert.deepEqual(urls(await fetchImdbPosterCandidates("Spider-Man 2", null)), [image("tt2")]);
});

test("IMDb does not treat a matching year as a matching title", async (t) => {
  mockFetch(t, { d: [imdbMovie("tt2", "Frozen II", 2019)] });
  assert.deepEqual(await fetchImdbPosterCandidates("Frozen", 2019), []);
  assert.equal(await fetchImdbSinglePoster("Frozen", 2019), null);
});

test("IMDb single-poster lookup requires the requested title and year", async (t) => {
  mockFetch(t, { d: [imdbMovie("tt2", "Frozen II", 2019), imdbMovie("tt1", "Frozen", 2013)] });
  assert.deepEqual(await fetchImdbSinglePoster("Frozen", 2013), { image: image("tt1"), source: "imdb" });
  assert.equal(await fetchImdbSinglePoster("Frozen", 2014), null);
});

test("IMDb rejects TV and game suggestions even when their titles match", async (t) => {
  mockFetch(t, { d: [
    { ...imdbMovie("tt1", "Frozen", 2013), qid: "tvSeries" },
    { ...imdbMovie("tt2", "Frozen", 2013), qid: "videoGame" },
    imdbMovie("tt3", "Frozen", 2013),
  ] });
  assert.deepEqual(urls(await fetchImdbPosterCandidates("Frozen", 2013)), [image("tt3")]);
});

test("iTunes retains only the requested movie and never falls back to another year", async (t) => {
  mockFetch(t, { results: [itunesMovie(2, "Frozen II", 2019), itunesMovie(1, "Frozen", 2013)] });
  assert.deepEqual(urls(await fetchItunesPosterCandidates("Frozen", null)), [image("1")]);
  assert.deepEqual(await fetchItunesPosterCandidates("Frozen", 2019), []);
  assert.deepEqual(await fetchItunesPosterCandidates("Frozen", 2014), []);
});

test("iTunes selects one release of a shared title", async (t) => {
  mockFetch(t, { results: [itunesMovie(1, "The Thing", 1982), itunesMovie(2, "The Thing", 2011)] });
  assert.deepEqual(urls(await fetchItunesPosterCandidates("The Thing", null)), [image("1")]);
  assert.deepEqual(urls(await fetchItunesPosterCandidates("The Thing", 2011)), [image("2")]);
});

test("TMDB returns posters for one title instead of the first three search matches", async (t) => {
  setEnv(t, "TMDB_API_KEY", "test-key");
  mockFetch(t, { results: [
    { id: 2, title: "Frozen II", release_date: "2019-01-01", poster_path: "/sequel.jpg" },
    { id: 1, title: "Frozen", release_date: "2013-01-01", poster_path: "/frozen.jpg", backdrop_path: "/backdrop.jpg" },
  ] });
  assert.deepEqual(new Set(urls(await fetchTmdbPosterCandidates("Frozen", null))), new Set([
    "https://image.tmdb.org/t/p/original/frozen.jpg",
  ]));
  assert.equal(await fetchTmdbSinglePoster("Frozen", 2014), null);
  assert.deepEqual(await fetchTmdbSinglePoster("Frozen", 2013), {
    image: "https://image.tmdb.org/t/p/w500/frozen.jpg", source: "tmdb",
  });
});

test("TMDB accepts an exact original title but rejects a wrong-title same-year result", async (t) => {
  setEnv(t, "TMDB_API_KEY", "test-key");
  mockFetch(t, { results: [
    { id: 2, title: "Unrelated", release_date: "2001-01-01", poster_path: "/wrong.jpg" },
    { id: 1, title: "Spirited Away", original_title: "千と千尋の神隠し", release_date: "2001-01-01", poster_path: "/correct.jpg" },
  ] });
  const matching = urls(await fetchTmdbPosterCandidates("千と千尋の神隠し", 2001));
  assert.equal(matching.length, 1);
  assert.ok(matching.every((url) => url.endsWith("/correct.jpg")));
  assert.deepEqual(await fetchTmdbPosterCandidates("Missing Movie", 2001), []);
});

test("Wikipedia rejects a redirect to a different film, release, or non-film page", async (t) => {
  let payload = { title: "Frozen II", description: "2019 American animated film", originalimage: { source: image("sequel") } };
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => payload }));
  assert.deepEqual(await fetchWikipediaPosterCandidates("Frozen", null), []);
  payload = { title: "Frozen (2013 film)", description: "2013 American animated film", originalimage: { source: image("frozen") } };
  assert.deepEqual(await fetchWikipediaPosterCandidates("Frozen", 2019), []);
  assert.deepEqual(urls(await fetchWikipediaPosterCandidates("Frozen", 2013)), [image("frozen")]);
  payload = { title: "Frozen", type: "disambiguation", description: "Topics referred to by the same term", originalimage: { source: image("other") } };
  assert.deepEqual(await fetchWikipediaPosterCandidates("Frozen", null), []);
});

test("Firecrawl requires movie metadata for each poster and ignores page-wide image links", async (t) => {
  setEnv(t, "FIRECRAWL_API_KEY", "test-key");
  let scrapeOptions;
  t.mock.method(FirecrawlApp.prototype, "search", async (_query, options) => {
    scrapeOptions = options.scrapeOptions;
    return { success: true, data: [{
      title: "Frozen posters",
      markdown: `![Frozen II](${image("raw-sequel")})`,
      links: [image("unrelated")],
      extract: { posters: [
        { url: image("frozen"), title: "Frozen", year: 2013 },
        { url: image("frozen-alternate"), title: "Frozen", year: 2013 },
        { url: image("sequel"), title: "Frozen II", year: 2019 },
        { url: image("remake"), title: "Frozen", year: 2019 },
        { url: image("unknown") },
      ] },
    }] };
  });
  assert.deepEqual(new Set(urls(await fetchFirecrawlPosterCandidates("Frozen", 2013))), new Set([
    image("frozen"), image("frozen-alternate"),
  ]));
  assert.deepEqual(await fetchFirecrawlPosterCandidates("Frozen", 2014), []);
  assert.deepEqual(scrapeOptions.formats, ["extract"]);
  assert.deepEqual(scrapeOptions.extract.schema.properties.posters.items.required, ["url", "title", "year"]);
});

for (const findPosters of [findPostersSequential, findPostersParallel]) {
  test(`${findPosters.name} filters the full merged list to one title and release`, async () => {
    const result = await findPosters("The Thing", null, { providers: [
      { name: "tmdb", fetcher: async () => [
        { url: image("remake"), title: "The Thing", year: 2011, relevance: 2 },
        { url: image("large-original-poster"), title: "Different Movie", year: 1982, relevance: 0 },
      ] },
      { name: "imdb", fetcher: async () => [{ url: image("original"), title: "The Thing", year: 1982, relevance: 2 }] },
      { name: "itunes", fetcher: async () => [{ url: image("alternate"), title: "The Thing", year: 1982, relevance: 2 }] },
    ] });
    assert.deepEqual(new Set(urls(result.posters)), new Set([image("original"), image("alternate")]));
    if (result.sourcesUsed) assert.deepEqual(new Set(result.sourcesUsed), new Set(["imdb", "itunes"]));
  });

  test(`${findPosters.name} excludes unidentified releases instead of reinserting an IMDb image`, async () => {
    const result = await findPosters("The Thing", null, { providers: [
      { name: "imdb", fetcher: async () => [{ url: image("unknown-release"), title: "The Thing", year: null }] },
      { name: "itunes", fetcher: async () => [{ url: image("original"), title: "The Thing", year: 1982 }] },
    ] });
    assert.deepEqual(urls(result.posters), [image("original")]);
  });
}

test("the CLI uses the same title and release filtering and keeps IMDb URLs", async (t) => {
  setEnv(t, "FIRECRAWL_API_KEY", undefined);
  setEnv(t, "TMDB_API_KEY", undefined);
  t.mock.method(globalThis, "fetch", async (url) => ({
    ok: true,
    json: async () => String(url).includes("media-imdb.com")
      ? { d: [imdbMovie("tt2", "Frozen II", 2019), imdbMovie("tt1", "Frozen", 2013)] }
      : String(url).includes("itunes.apple.com")
        ? { results: [itunesMovie(2, "Frozen II", 2019), itunesMovie(1, "Frozen", 2013)] }
        : { title: "Frozen (2013 film)", description: "2013 American animated film", originalimage: { source: image("wiki-frozen") } },
  }));
  const posters = await getMoviePosters("Frozen");
  assert.equal(posters[0], image("tt1"));
  assert.deepEqual(new Set(posters), new Set([image("tt1"), image("1"), image("wiki-frozen")]));
  assert.deepEqual(await getMoviePosters("Frozen", 2014), []);
});

for (const findPosters of [findPostersSequential, findPostersParallel]) {
  test(`${findPosters.name} returns no posters when every provider has only wrong movies`, async (t) => {
    setEnv(t, "FIRECRAWL_API_KEY", undefined);
    setEnv(t, "TMDB_API_KEY", undefined);
    t.mock.method(globalThis, "fetch", async (url) => ({
      ok: true,
      json: async () => String(url).includes("media-imdb.com")
        ? { d: [imdbMovie("tt2", "Frozen II", 2019)] }
        : String(url).includes("itunes.apple.com")
          ? { results: [itunesMovie(2, "Frozen II", 2019)] }
          : { title: "Frozen II", description: "2019 American animated film", originalimage: { source: image("sequel") } },
    }));
    assert.deepEqual((await findPosters("Frozen", 2019)).posters, []);
  });
}

test("the sequential lookup passes the IMDb release to subsequent provider searches", async (t) => {
  setEnv(t, "FIRECRAWL_API_KEY", undefined);
  setEnv(t, "TMDB_API_KEY", undefined);
  t.mock.method(globalThis, "fetch", async (url) => ({
    ok: true,
    json: async () => String(url).includes("media-imdb.com")
      ? { d: [imdbMovie("tt1", "The Thing", 1982)] }
      : String(url).includes("itunes.apple.com")
        ? { results: [itunesMovie(2, "The Thing", 2011), itunesMovie(1, "The Thing", 1982)] }
        : { title: "The Thing (2011 film)", description: "2011 American film", originalimage: { source: image("remake") } },
  }));
  assert.deepEqual(new Set((await findPostersSequential("The Thing", null)).posters), new Set([image("tt1"), image("1")]));
});

test("the final sequential merge retains the release selected during the provider loop", async () => {
  const legacy = image("large-original-poster-2000x3000");
  let subsequentYear;
  const result = await findPostersSequential("The Thing", null, { providers: [
    { name: "imdb", fetcher: async () => [legacy, { url: image("1982"), title: "The Thing", year: 1982 }] },
    { name: "tmdb", fetcher: async () => [{ url: image("2011"), title: "The Thing", year: 2011 }] },
    { name: "itunes", fetcher: async ({ year }) => { subsequentYear = year; return []; } },
  ] });
  assert.equal(subsequentYear, 2011);
  assert.deepEqual(result.posters, [legacy, image("2011")]);
});
