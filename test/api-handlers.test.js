import assert from "node:assert/strict";
import test from "node:test";

import { createLatestPosterHandler } from "../api/latest-poster.js";
import { createSearchHandler } from "../api/search.js";

function createResponse() {
  return {
    body: undefined,
    headers: {},
    redirectUrl: undefined,
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.redirectUrl = url;
      return this;
    },
  };
}

async function invoke(handler, { method = "GET", query = {} } = {}) {
  const response = createResponse();
  await handler({ method, query }, response);
  return response;
}

function memoryStore(record = null) {
  return {
    record,
    async getLatestPoster() {
      return this.record;
    },
    async saveLatestPoster(title, url) {
      this.record = { title, url, timestamp: "2026-09-15T00:00:00.000Z" };
    },
  };
}

const quietLogger = { error() {} };

test("search success returns the documented JSON structure and updates mocked storage", async () => {
  const store = memoryStore();
  const handler = createSearchHandler({
    store,
    logger: quietLogger,
    findPosters: async (title, year) => {
      assert.equal(title, "Alien");
      assert.equal(year, 1979);
      return {
        posters: ["https://images.example.test/alien.jpg"],
        source: "mock-provider",
        sourcesTried: ["mock-provider"],
      };
    },
  });

  const response = await invoke(handler, { query: { query: " Alien ", year: "1979" } });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    query: "Alien",
    posters: ["https://images.example.test/alien.jpg"],
    image: "https://images.example.test/alien.jpg",
    source: "mock-provider",
    sourcesTried: ["mock-provider"],
  });
  assert.equal(store.record.title, "Alien");
  assert.equal(store.record.url, "https://images.example.test/alien.jpg");
});

test("search rejects invalid requests without calling a provider", async () => {
  let providerCalls = 0;
  const handler = createSearchHandler({
    store: memoryStore(),
    findPosters: async () => {
      providerCalls += 1;
      return { posters: [] };
    },
  });

  const missing = await invoke(handler, { query: { query: "   " } });
  assert.equal(missing.statusCode, 400);
  assert.deepEqual(missing.body, { error: "Missing query parameter: query" });

  const wrongMethod = await invoke(handler, { method: "POST", query: { query: "Alien" } });
  assert.equal(wrongMethod.statusCode, 405);
  assert.deepEqual(wrongMethod.body, { error: "Method Not Allowed" });
  assert.equal(providerCalls, 0);
});

test("search returns structured 404 JSON when mocked providers find no results", async () => {
  const handler = createSearchHandler({
    store: memoryStore(),
    findPosters: async () => ({ posters: [], source: null, sourcesTried: ["mock-provider"] }),
  });

  const response = await invoke(handler, { query: { query: "Unknown Film" } });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { query: "Unknown Film", error: "No image found" });
});

test("search converts a mocked provider failure to structured 500 JSON", async () => {
  const handler = createSearchHandler({
    store: memoryStore(),
    findPosters: async () => {
      throw new Error("mock provider unavailable");
    },
  });

  const response = await invoke(handler, { query: { query: "Alien" } });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: "mock provider unavailable" });
});

test("latest-poster redirects to the exact URL held in mocked shared storage", async () => {
  const poster = {
    title: "Alien",
    url: "https://images.example.test/alien-original.jpg?size=full",
    timestamp: "2026-09-15T00:00:00.000Z",
  };
  const handler = createLatestPosterHandler({ store: memoryStore(poster), logger: quietLogger });

  const redirect = await invoke(handler);
  assert.equal(redirect.statusCode, 307);
  assert.equal(redirect.redirectUrl, poster.url);
  assert.equal(redirect.body, undefined);

  const json = await invoke(handler, { query: { json: "1" } });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.body, poster);
});
