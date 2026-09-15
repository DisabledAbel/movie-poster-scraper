import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchImdbPosterCandidates,
  findPostersParallel,
  findPostersSequential,
} from "../lib/providers.js";
import { rankPosterCandidates } from "../lib/poster-utils.js";

const image = (name) => `https://images.example.com/${name}.jpg`;

async function withImdbResults(t, results) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ d: results }) });
  t.after(() => { globalThis.fetch = originalFetch; });
}

function imdbMovie(title, year, url) {
  return { id: `tt${year}${title.length}`, l: title, y: year, i: { imageUrl: url } };
}

test("Frozen outranks a higher-scoring Frozen II image", async (t) => {
  await withImdbResults(t, [
    imdbMovie("Frozen II", 2019, image("large-original-movie-poster-2000x3000")),
    imdbMovie("Frozen", 2013, image("plain")),
  ]);

  const candidates = await fetchImdbPosterCandidates("Frozen", null);
  assert.equal(candidates[0].url, image("plain"));
  assert.equal(candidates[0].title, "Frozen");
});

test("Frozen II is selected when the sequel is explicitly requested", async (t) => {
  await withImdbResults(t, [
    imdbMovie("Frozen", 2013, image("large-original-movie-poster-2000x3000")),
    imdbMovie("Frozen II", 2019, image("sequel")),
  ]);

  const candidates = await fetchImdbPosterCandidates("Frozen II", null);
  assert.equal(candidates[0].title, "Frozen II");
});

test("exact matching normalizes case and whitespace without dropping sequel numbers", async (t) => {
  await withImdbResults(t, [
    imdbMovie("Frozen", 2013, image("large-original-poster")),
    imdbMovie("  FROZEN   II ", 2019, image("sequel")),
  ]);

  const candidates = await fetchImdbPosterCandidates(" frozen ii ", null);
  assert.equal(candidates[0].title, "  FROZEN   II ");
});

test("a supplied year strictly selects the matching release of a shared title", async (t) => {
  await withImdbResults(t, [
    imdbMovie("The Thing", 1982, image("original-large-poster-2000x3000")),
    imdbMovie("The Thing", 2011, image("remake")),
  ]);

  const candidates = await fetchImdbPosterCandidates("The Thing", 2011);
  assert.deepEqual(candidates.map(({ year }) => year), [2011]);
  assert.equal(candidates[0].url, image("remake"));
});

test("the final sequential merge preserves the relevant IMDb poster first", async () => {
  const exact = { url: image("plain"), title: "Frozen", provider: "imdb", relevance: 2 };
  const sequel = { url: image("large-original-movie-poster-2000x3000"), title: "Frozen II", provider: "imdb", relevance: 0 };
  const result = await findPostersSequential("Frozen", null, {
    providers: [
      { name: "imdb", fetcher: async () => [exact, sequel] },
      { name: "itunes", fetcher: async () => [image("itunes-large-original-poster-2000x3000")] },
    ],
    providerTimeoutMs: 50,
    overallTimeoutMs: 200,
  });

  assert.equal(result.posters[0], exact.url);
  assert.equal(typeof result.posters[0], "string");
});

test("the sequential merge validates IMDb posters before selecting the first result", async () => {
  const fallback = image("fallback");
  const result = await findPostersSequential("Frozen", null, {
    providers: [
      { name: "imdb", fetcher: async () => [{ url: "not-an-image", relevance: 2 }] },
      { name: "itunes", fetcher: async () => [fallback] },
    ],
    providerTimeoutMs: 50,
    overallTimeoutMs: 200,
  });

  assert.deepEqual(result.posters, [fallback]);
  assert.equal(result.source, "itunes");
});

test("the IMDb-first merge removes canonical duplicates and remains limited to 15 posters", async () => {
  const current = `${image("frozen")}?size=large`;
  const duplicate = `${image("frozen")}?size=small`;
  const extras = Array.from({ length: 20 }, (_, index) => image(`extra-${index}`));
  const result = await findPostersSequential("Frozen", null, {
    providers: [
      { name: "imdb", fetcher: async () => [{ url: current, relevance: 2 }] },
      { name: "itunes", fetcher: async () => [duplicate, ...extras] },
    ],
    providerTimeoutMs: 50,
    overallTimeoutMs: 200,
  });

  assert.equal(result.posters[0], current);
  assert.equal(result.posters.includes(duplicate), false);
  assert.equal(result.posters.length, 15);
});

test("image quality breaks ties only among equally relevant candidates", () => {
  const ranked = rankPosterCandidates([
    { url: image("plain"), relevance: 2 },
    { url: image("large-original-movie-poster-2000x3000"), relevance: 2 },
  ]);
  assert.equal(ranked[0].url, image("large-original-movie-poster-2000x3000"));
});

test("parallel public results keep their established object response format", async () => {
  const result = await findPostersParallel("Frozen", null, {
    providers: [{
      name: "imdb",
      fetcher: async () => [{ url: image("frozen"), relevance: 2, provider: "imdb" }],
    }],
  });

  assert.deepEqual(Object.keys(result).sort(), ["posters", "sourcesFailed", "sourcesUsed"]);
  assert.deepEqual(Object.keys(result.posters[0]).sort(), ["confidence", "provider", "score", "url"]);
  assert.equal(result.posters[0].url, image("frozen"));
});
