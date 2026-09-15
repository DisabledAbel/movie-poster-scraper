import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLatestPosterHandler } from "../api/latest-poster.js";
import { createSearchHandler } from "../api/search.js";
import {
  createFileLatestPosterAdapter,
  createLatestPosterAdapter,
  createLatestPosterStore,
  createRedisLatestPosterAdapter,
} from "../lib/latest-poster-store.js";

function response() {
  return {
    headers: {}, statusCode: 200, body: undefined, redirectUrl: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectUrl = url; return this; },
  };
}

async function invoke(handler, query = {}) {
  const res = response();
  await handler({ method: "GET", query }, res);
  return res;
}

function sharedAdapter() {
  const state = { record: null };
  return {
    create() {
      return {
        async get() { return state.record; },
        async set(record) { state.record = structuredClone(record); },
      };
    },
  };
}

const quiet = { error() {} };

test("separate writer and reader handler instances share the latest record", async () => {
  const shared = sharedAdapter();
  const writerStore = createLatestPosterStore({ adapter: shared.create(), now: () => new Date("2026-01-01Z") });
  const readerStore = createLatestPosterStore({ adapter: shared.create() });
  const writer = createSearchHandler({
    store: writerStore, logger: quiet,
    findPosters: async () => ({ posters: ["https://images.test/alien.jpg"], source: "test", sourcesTried: ["test"] }),
  });
  assert.equal((await invoke(writer, { query: "Alien" })).statusCode, 200);

  const read = await invoke(createLatestPosterHandler({ store: readerStore, logger: quiet }), { json: "1" });
  assert.deepEqual(read.body, {
    title: "Alien", url: "https://images.test/alien.jpg", timestamp: "2026-01-01T00:00:00.000Z",
  });
});

test("a newly created store reads a record saved by an earlier store", async () => {
  const shared = sharedAdapter();
  await createLatestPosterStore({ adapter: shared.create() }).saveLatestPoster("First", "https://images.test/first.jpg");
  assert.equal((await createLatestPosterStore({ adapter: shared.create() }).getLatestPoster()).title, "First");
});

test("new successes update while empty and failed searches preserve the record", async () => {
  const shared = sharedAdapter();
  const store = createLatestPosterStore({ adapter: shared.create() });
  await store.saveLatestPoster("Old", "https://images.test/old.jpg");
  const success = createSearchHandler({ store, logger: quiet, findPosters: async () => ({ posters: ["https://images.test/new.jpg"] }) });
  await invoke(success, { query: "New" });
  assert.equal((await store.getLatestPoster()).title, "New");

  const empty = createSearchHandler({ store, logger: quiet, findPosters: async () => ({ posters: [] }) });
  assert.equal((await invoke(empty, { query: "Empty" })).statusCode, 404);
  const failed = createSearchHandler({ store, logger: quiet, findPosters: async () => { throw new Error("provider failed"); } });
  assert.equal((await invoke(failed, { query: "Failed" })).statusCode, 500);
  assert.equal((await store.getLatestPoster()).title, "New");
});

test("a storage write failure does not break a successful search", async () => {
  const store = createLatestPosterStore({ adapter: { get: async () => null, set: async () => { throw new Error("offline"); } } });
  const handler = createSearchHandler({ store, logger: quiet, findPosters: async () => ({ posters: ["https://images.test/good.jpg"] }) });
  const res = await invoke(handler, { query: "Good" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.image, "https://images.test/good.jpg");
});

test("missing latest records and storage outages have distinct responses", async () => {
  const missingStore = createLatestPosterStore({ adapter: { get: async () => null, set: async () => {} } });
  assert.equal((await invoke(createLatestPosterHandler({ store: missingStore, logger: quiet }), { json: "1" })).statusCode, 404);
  const unavailableStore = createLatestPosterStore({ adapter: { get: async () => { throw new Error("offline"); }, set: async () => {} } });
  const unavailable = await invoke(createLatestPosterHandler({ store: unavailableStore, logger: quiet }), { json: "1" });
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.body, { error: "Latest poster storage is temporarily unavailable" });
});

test("latest JSON and redirect responses disable browser and CDN caching", async () => {
  const store = createLatestPosterStore({ adapter: { get: async () => ({ title: "A", url: "https://images.test/a.jpg", timestamp: "now" }), set: async () => {} } });
  for (const query of [{ json: "1" }, {}]) {
    const res = await invoke(createLatestPosterHandler({ store, logger: quiet }), query);
    assert.match(res.headers["cache-control"], /no-store/);
    assert.equal(res.headers["cdn-cache-control"], "no-store");
    assert.equal(res.headers["vercel-cdn-cache-control"], "no-store");
  }
});

test("local development works without production credentials and survives a new adapter", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "latest-local-"));
  const file = path.join(directory, "latest.json");
  const first = createLatestPosterStore({ adapter: createFileLatestPosterAdapter({ file }) });
  await first.saveLatestPoster("Local", "https://images.test/local.jpg");
  const second = createLatestPosterStore({ adapter: createFileLatestPosterAdapter({ file }) });
  assert.equal((await second.getLatestPoster()).title, "Local");
  assert.doesNotThrow(() => createLatestPosterAdapter({ env: {} }));
  await fs.rm(directory, { recursive: true, force: true });
});

test("production never falls back to local state when credentials are missing", async () => {
  const store = createLatestPosterStore({
    adapter: createLatestPosterAdapter({ env: { VERCEL: "1" } }),
    env: { LATEST_POSTER_STORAGE_TIMEOUT_MS: "20" },
  });
  await assert.rejects(store.getLatestPoster(), /storage is unavailable/);
});

test("storage operations are bounded by the configured timeout", async () => {
  const store = createLatestPosterStore({
    adapter: { get: async () => new Promise(() => {}), set: async () => new Promise(() => {}) },
    env: { LATEST_POSTER_STORAGE_TIMEOUT_MS: "10" },
  });
  const started = Date.now();
  await assert.rejects(store.getLatestPoster(), /storage is unavailable/);
  assert.ok(Date.now() - started < 200, "storage timeout should return promptly");
});

test("timed-out Redis reads and writes abort the underlying fetch", async () => {
  const signals = [];
  const fetchImpl = async (_url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  };
  const store = createLatestPosterStore({
    adapter: createRedisLatestPosterAdapter({
      url: "https://redis.example.test",
      token: "test-token",
      fetchImpl,
    }),
    env: { LATEST_POSTER_STORAGE_TIMEOUT_MS: "10" },
  });

  await assert.rejects(store.getLatestPoster(), /storage is unavailable/);
  assert.equal(signals[0].aborted, true);
  await assert.rejects(store.saveLatestPoster("Alien", "https://images.test/alien.jpg"), /storage is unavailable/);
  assert.equal(signals[1].aborted, true);
});
