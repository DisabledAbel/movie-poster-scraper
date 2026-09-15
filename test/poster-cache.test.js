import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createPosterHandler } from "../api/poster/[title].js";
import {
  DEFAULT_POSTER_CACHE_TTL_MS,
  getCacheDirectory,
  getPosterCacheTtlMs,
} from "../lib/cache-utils.js";

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function request(handler, title = "Alien") {
  const res = response();
  await handler({ query: { title } }, res);
  return res;
}

function cacheFile(cacheDir, title = "Alien") {
  const cacheKey = createHash("sha256").update(title).digest("hex");
  return path.join(cacheDir, `${cacheKey}.json`);
}

function writeCacheEntry(cacheDir, payload, expiresAt) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile(cacheDir, payload?.title || "Alien"), JSON.stringify({
    expiresAt,
    payload,
  }));
}

test("importing the route performs no filesystem writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "poster-import-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const route = pathToFileURL(path.resolve(originalCwd, "api/poster/[title].js"));
    route.searchParams.set("test", String(Date.now()));
    await import(route.href);
    assert.equal(fs.existsSync(path.join(root, ".cache")), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Vercel uses temporary storage while local development uses .cache", () => {
  assert.equal(getCacheDirectory({ VERCEL: "1" }), path.join(os.tmpdir(), "movie-poster-cache"));
  assert.equal(getCacheDirectory({}), path.resolve(".cache"));
});

test("poster cache TTL accepts only positive finite milliseconds", () => {
  assert.equal(getPosterCacheTtlMs({ POSTER_CACHE_TTL_MS: "60000" }), 60000);
  for (const value of ["0", "-1", "invalid", "Infinity"]) {
    assert.equal(getPosterCacheTtlMs({ POSTER_CACHE_TTL_MS: value }), DEFAULT_POSTER_CACHE_TTL_MS);
  }
});

test("a fresh successful cache entry avoids another provider request", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-hit-"));
  const cached = { title: "Alien", posters: ["cached"] };
  writeCacheEntry(cacheDir, cached, "2026-09-16T00:00:00.000Z");
  let calls = 0;
  const handler = createPosterHandler({
    cacheDir,
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
    findPosters: async () => { calls += 1; },
  });
  const res = await request(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, cached);
  assert.equal(calls, 0);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("an expired entry triggers a fresh lookup and is replaced after success", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-expired-"));
  writeCacheEntry(cacheDir, { title: "Alien", posters: ["stale"] }, "2026-09-14T00:00:00.000Z");
  const clock = Date.parse("2026-09-15T00:00:00.000Z");
  let calls = 0;
  const handler = createPosterHandler({
    cacheDir,
    cacheTtlMs: 1000,
    now: () => clock,
    findPosters: async () => { calls += 1; return { posters: ["fresh"] }; },
  });

  assert.deepEqual((await request(handler)).body, { title: "Alien", posters: ["fresh"] });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile(cacheDir), "utf8")), {
    expiresAt: "2026-09-15T00:00:01.000Z",
    payload: { title: "Alien", posters: ["fresh"] },
  });
  assert.deepEqual((await request(handler)).body, { title: "Alien", posters: ["fresh"] });
  assert.equal(calls, 1);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

for (const cacheState of ["missing", "corrupt"]) {
  test(`${cacheState} cache triggers a fresh lookup`, async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), `poster-${cacheState}-`));
    const cacheDir = path.join(parent, "cache");
    if (cacheState === "corrupt") {
      fs.mkdirSync(cacheDir);
      fs.writeFileSync(cacheFile(cacheDir), "not json");
    }
    let calls = 0;
    const handler = createPosterHandler({
      cacheDir,
      findPosters: async () => { calls += 1; return { posters: ["fresh"] }; },
    });
    const res = await request(handler);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { title: "Alien", posters: ["fresh"] });
    assert.equal(calls, 1);
    fs.rmSync(parent, { recursive: true, force: true });
  });
}

for (const [cacheState, contents] of [
  ["empty", { expiresAt: "2026-09-16T00:00:00.000Z", payload: { title: "Alien", posters: [] } }],
  ["invalid timestamp", { expiresAt: "not-a-date", payload: { title: "Alien", posters: ["stale"] } }],
  ["legacy", { title: "Alien", posters: ["stale"] }],
  ["malformed payload", { expiresAt: "2026-09-16T00:00:00.000Z", payload: "invalid" }],
]) {
  test(`existing ${cacheState} cache entry is ignored`, async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-invalid-"));
    fs.writeFileSync(cacheFile(cacheDir), JSON.stringify(contents));
    let calls = 0;
    const handler = createPosterHandler({
      cacheDir,
      now: () => Date.parse("2026-09-15T00:00:00.000Z"),
      findPosters: async () => { calls += 1; return { posters: ["fresh"] }; },
    });
    assert.deepEqual((await request(handler)).body, { title: "Alien", posters: ["fresh"] });
    assert.equal(calls, 1);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
}

test("an empty result is not cached and the next request can succeed", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-empty-"));
  let calls = 0;
  const handler = createPosterHandler({
    cacheDir,
    findPosters: async () => ({ posters: ++calls === 1 ? [] : ["recovered"] }),
  });
  assert.deepEqual((await request(handler)).body, { title: "Alien", posters: [] });
  assert.equal(fs.existsSync(cacheFile(cacheDir)), false);
  assert.deepEqual((await request(handler)).body, { title: "Alien", posters: ["recovered"] });
  assert.equal(calls, 2);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("a provider exception does not create a cache entry", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-error-"));
  const handler = createPosterHandler({
    cacheDir,
    findPosters: async () => { throw new Error("provider unavailable"); },
  });
  const res = await request(handler);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "provider unavailable" });
  assert.equal(fs.existsSync(cacheFile(cacheDir)), false);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

for (const failure of ["creation", "write"]) {
  test(`cache ${failure} failure does not hide a successful provider result`, async () => {
    const fileSystem = {
      readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      mkdirSync() { if (failure === "creation") throw new Error("read only"); },
      writeFileSync() { throw new Error("write failed"); },
    };
    const handler = createPosterHandler({
      cacheDir: "/unwritable/cache",
      fileSystem,
      findPosters: async () => ({ posters: ["fresh"] }),
    });
    const res = await request(handler);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { title: "Alien", posters: ["fresh"] });
  });
}

test("local caching writes a reusable response", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "poster-local-"));
  const cacheDir = path.join(parent, ".cache");
  let calls = 0;
  const handler = createPosterHandler({
    cacheDir,
    findPosters: async () => { calls += 1; return { posters: ["local"] }; },
  });
  assert.equal((await request(handler)).statusCode, 200);
  assert.equal((await request(handler)).statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(cacheFile(cacheDir)), true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("expiration metadata stays out of fresh and cached API responses", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-metadata-"));
  const handler = createPosterHandler({
    cacheDir,
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
    findPosters: async () => ({ posters: ["fresh"] }),
  });
  for (const res of [await request(handler), await request(handler)]) {
    assert.deepEqual(res.body, { title: "Alien", posters: ["fresh"] });
    assert.equal(Object.hasOwn(res.body, "expiresAt"), false);
    assert.equal(Object.hasOwn(res.body, "payload"), false);
  }
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("cache filenames do not expose titles or escape the cache directory", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "poster-key-"));
  const cacheDir = path.join(parent, "cache");
  const title = "../../Sensitive Movie";
  const handler = createPosterHandler({
    cacheDir,
    findPosters: async () => ({ posters: ["fresh"] }),
  });
  assert.equal((await request(handler, title)).statusCode, 200);
  assert.deepEqual(fs.readdirSync(cacheDir), [path.basename(cacheFile(cacheDir, title))]);
  assert.equal(fs.existsSync(path.join(parent, "Sensitive Movie.json")), false);
  fs.rmSync(parent, { recursive: true, force: true });
});
