import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createPosterHandler } from "../api/poster/[title].js";
import { getCacheDirectory } from "../lib/cache-utils.js";

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

test("a valid cache hit avoids a provider request", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-hit-"));
  const cached = { title: "Alien", posters: ["cached"] };
  fs.writeFileSync(path.join(cacheDir, "alien.json"), JSON.stringify(cached));
  let calls = 0;
  const handler = createPosterHandler({ cacheDir, findPosters: async () => { calls += 1; } });
  const res = await request(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, cached);
  assert.equal(calls, 0);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

for (const cacheState of ["missing", "corrupt"]) {
  test(`${cacheState} cache triggers a fresh lookup`, async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), `poster-${cacheState}-`));
    const cacheDir = path.join(parent, "cache");
    if (cacheState === "corrupt") {
      fs.mkdirSync(cacheDir);
      fs.writeFileSync(path.join(cacheDir, "alien.json"), "not json");
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
  assert.equal(fs.existsSync(path.join(cacheDir, "alien.json")), true);
  fs.rmSync(parent, { recursive: true, force: true });
});
