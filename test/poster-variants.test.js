import assert from "node:assert/strict";
import test from "node:test";
import FirecrawlApp from "@mendable/firecrawl-js";

import {
  fetchTmdbPosterCandidates,
  findPostersParallel,
  findPostersSequential,
} from "../lib/providers.js";
import { rankPosterCandidates } from "../lib/poster-utils.js";

const tmdbImage = (file, size = "original") => `https://image.tmdb.org/t/p/${size}/${file}.jpg`;
const frozen = { id: 109445, title: "Frozen", release_date: "2013-11-20", poster_path: "/main.jpg" };

function mockTmdb(t, gallery, match = frozen) {
  const previous = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "test-key";
  t.after(() => {
    if (previous === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previous;
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: new URL(url), signal: options?.signal });
    if (String(url).includes("/search/movie?")) {
      return { ok: true, json: async () => ({ results: [
        { id: 330457, title: "Frozen II", release_date: "2019-11-20", poster_path: "/sequel.jpg" },
        match,
      ] }) };
    }
    return typeof gallery === "function" ? gallery(options) : { ok: true, json: async () => gallery };
  });
  return requests;
}

test("TMDB collects distinct alternate posters from only the selected movie's gallery", async (t) => {
  const requests = mockTmdb(t, {
    id: frozen.id,
    posters: ["main", "theatrical", "teaser", "international", "character", "teaser"].map((file) => ({ file_path: `/${file}.jpg` })),
    backdrops: [{ file_path: "/backdrop.jpg" }],
    logos: [{ file_path: "/logo.png" }],
  });
  const posters = await fetchTmdbPosterCandidates("Frozen", 2013);
  assert.deepEqual(new Set(posters.map(({ url }) => url)), new Set(["main", "theatrical", "teaser", "international", "character"].map((file) => tmdbImage(file))));
  assert.ok(posters.every(({ title, year, movieId }) => title === "Frozen" && year === 2013 && movieId === frozen.id));
  assert.deepEqual(requests.map(({ url }) => url.pathname), ["/3/search/movie", `/3/movie/${frozen.id}/images`]);
  assert.equal(requests[1].url.searchParams.get("language"), null);
  assert.ok(requests[1].signal instanceof AbortSignal);
});

test("TMDB finds alternate posters even when the search hit has no main poster", async (t) => {
  mockTmdb(t, { id: frozen.id, posters: [{ file_path: "/alternate.jpg" }] }, { ...frozen, poster_path: null });
  assert.deepEqual((await fetchTmdbPosterCandidates("Frozen", 2013)).map(({ url }) => url), [tmdbImage("alternate")]);
});

test("TMDB keeps its main poster when the gallery belongs to another movie", async (t) => {
  mockTmdb(t, { id: 330457, posters: [{ file_path: "/sequel.jpg" }] });
  assert.deepEqual((await fetchTmdbPosterCandidates("Frozen", 2013)).map(({ url }) => url), [tmdbImage("main")]);
});

for (const [name, gallery] of [
  ["HTTP failure", async () => ({ ok: false })],
  ["network failure", async () => { throw new Error("Gallery unavailable"); }],
  ["malformed JSON", async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } })],
]) {
  test(`TMDB keeps its main poster after a gallery ${name}`, async (t) => {
    mockTmdb(t, gallery);
    assert.deepEqual((await fetchTmdbPosterCandidates("Frozen", 2013)).map(({ url }) => url), [tmdbImage("main")]);
  });
}

test("a stalled TMDB gallery is aborted without losing the main poster", async (t) => {
  let gallerySignal;
  mockTmdb(t, async ({ signal }) => {
    gallerySignal = signal;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  const posters = await fetchTmdbPosterCandidates("Frozen", 2013, { timeoutMs: 50 });
  assert.deepEqual(posters.map(({ url }) => url), [tmdbImage("main")]);
  assert.equal(gallerySignal?.aborted, true);
});

test("TMDB never requests a gallery for a different release year", async (t) => {
  const requests = mockTmdb(t, { id: frozen.id, posters: [{ file_path: "/alternate.jpg" }] });
  assert.deepEqual(await fetchTmdbPosterCandidates("Frozen", 2019), []);
  assert.equal(requests.length, 1);
});

test("a large gallery fills the 15-poster result while retaining the verified IMDb poster first", async (t) => {
  mockTmdb(t, {
    id: frozen.id,
    posters: Array.from({ length: 20 }, (_, index) => ({ file_path: `/alternate-${index}.jpg` })),
  });
  const current = "https://images.example.com/current.jpg";
  const result = await findPostersSequential("Frozen", 2013, { providers: [
    { name: "imdb", fetcher: async () => [{ url: current, title: "Frozen", year: 2013, movieId: "tt2294629" }] },
    { name: "tmdb", fetcher: (context) => fetchTmdbPosterCandidates("Frozen", context.year, context) },
  ] });
  assert.equal(result.posters[0], current);
  assert.equal(result.source, "imdb");
  assert.equal(result.posters.length, 15);
  assert.equal(new Set(result.posters).size, 15);
  assert.ok(result.posters.slice(1).every((url) => url.startsWith("https://image.tmdb.org/t/p/original/")));
});

test("TMDB resize URLs count as one poster while different artwork remains distinct", () => {
  const posters = rankPosterCandidates([
    tmdbImage("main", "w500"), tmdbImage("main"), tmdbImage("alternate"),
  ]);
  assert.deepEqual(posters.map(({ url }) => url), [tmdbImage("main"), tmdbImage("alternate")]);
});

test("the built-in Firecrawl search collects gallery variants for the release selected by IMDb", async (t) => {
  for (const [name, value] of [["TMDB_API_KEY", undefined], ["FIRECRAWL_API_KEY", "test-key"]]) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const current = "https://images.example.com/current.jpg";
  t.mock.method(globalThis, "fetch", async (url) => ({ ok: true, json: async () =>
    String(url).includes("media-imdb.com")
      ? { d: [{ id: "tt2294629", l: "Frozen", y: 2013, qid: "movie", i: { imageUrl: current } }] }
      : String(url).includes("itunes.apple.com") ? { results: [] } : { type: "disambiguation" },
  }));
  let searchQuery;
  let searchOptions;
  t.mock.method(FirecrawlApp.prototype, "search", async (query, options) => {
    searchQuery = query;
    searchOptions = options;
    return { success: true, data: [{ extract: { posters: [
      ...Array.from({ length: 6 }, (_, index) => ({ url: tmdbImage(`gallery-${index}`), title: "Frozen", year: 2013 })),
      { url: tmdbImage("sequel"), title: "Frozen II", year: 2019 },
      { url: tmdbImage("other-release"), title: "Frozen", year: 2010 },
    ] } }] };
  });
  const result = await findPostersSequential("Frozen", null, { firecrawlTimeoutMs: 15000 });
  assert.equal(searchQuery, '"Frozen" 2013 movie poster gallery');
  assert.equal(searchOptions.timeout, 15000);
  assert.equal(searchOptions.scrapeOptions.onlyMainContent, false);
  assert.deepEqual(new Set(result.posters), new Set([current, ...Array.from({ length: 6 }, (_, index) => tmdbImage(`gallery-${index}`))]));
  assert.equal(result.posters[0], current);
  assert.equal(result.sourcesTried.at(-1), "firecrawl");
});

for (const findPosters of [findPostersSequential, findPostersParallel]) {
  test(`${findPosters.name} gives Firecrawl a bounded extraction budget and passes its fetch context`, async () => {
    let firecrawlContext;
    const result = await findPosters("Frozen", 2013, {
      providers: [{ name: "firecrawl", fetcher: async (context) => {
        firecrawlContext = context;
        return Array.from({ length: 6 }, (_, index) => ({ url: tmdbImage(`alternate-${index}`), title: "Frozen", year: 2013 }));
      } }],
      now: () => 0,
      setTimer: () => 1,
      clearTimer: () => {},
    });
    assert.equal(result.posters.length, 6);
    assert.equal(firecrawlContext?.timeoutMs, 15000);
    assert.ok(firecrawlContext.signal instanceof AbortSignal);
  });

  test(`${findPosters.name} still limits the expanded extraction to the remaining search budget`, async () => {
    let receivedTimeout;
    await findPosters("Frozen", 2013, {
      providers: [{ name: "firecrawl", fetcher: async ({ timeoutMs }) => { receivedTimeout = timeoutMs; return []; } }],
      overallTimeoutMs: 100,
      now: () => 0,
      setTimer: () => 1,
      clearTimer: () => {},
    });
    assert.equal(receivedTimeout, 100);
  });
}
