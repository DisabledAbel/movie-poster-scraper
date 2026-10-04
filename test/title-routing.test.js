import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const title = "Amélie & Friends";
const poster = "https://images.example.test/amelie-2001.jpg";
const prefixes = ["/api/poster/", "/api/poster-img/", "/poster-img/", "/poster/"];
let server;
let directory;
let origin;

before(async () => {
  directory = mkdtempSync(join(tmpdir(), "poster-title-routing-"));
  const script = `
    import http from 'node:http';
    const createServer = http.createServer;
    http.createServer = (...args) => {
      const server = createServer(...args);
      server.once('listening', () => process.send({ port: server.address().port }));
      return server;
    };
    globalThis.fetch = async (url) => {
      if (!String(url).includes('media-imdb.com')) return { ok: false };
      return { ok: true, json: async () => ({ d: [{
        id: 'tt1234567', l: ${JSON.stringify(title)}, y: 2001, qid: 'movie',
        i: { imageUrl: ${JSON.stringify(poster)} },
      }] }) };
    };
    await import(${JSON.stringify(new URL("../index.js", import.meta.url).href)});
  `;
  server = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: directory,
    env: {
      ...process.env,
      PORT: "0", NODE_ENV: "test", VERCEL: "", NOW_REGION: "",
      TMDB_API_KEY: "", FIRECRAWL_API_KEY: "",
      KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "",
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const [message] = await once(server, "message", { signal: AbortSignal.timeout(5000) });
  origin = `http://127.0.0.1:${message.port}`;
});

after(async () => {
  if (server?.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("malformed percent encoding returns JSON 400 across all poster title routes", async () => {
  for (const prefix of prefixes) {
    for (const malformed of ["%", "%GG", "%E0%A4"]) {
      const res = await fetch(`${origin}${prefix}${malformed}.jpg?year=2001`, { redirect: "manual" });
      assert.equal(res.status, 400, `${prefix}${malformed}`);
      assert.match(res.headers.get("content-type"), /application\/json/);
      assert.deepEqual(await res.json(), { error: "Invalid title encoding" });
    }
  }
});

test("valid encoded titles retain JSON lookup, image redirects, and release-year handling", async () => {
  for (const prefix of prefixes) {
    const suffix = prefix === "/api/poster/" ? "" : ".jpg";
    const res = await fetch(`${origin}${prefix}${encodeURIComponent(title)}${suffix}?year=2001`, { redirect: "manual" });
    if (prefix === "/api/poster/") {
      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.title, title);
      assert.deepEqual(payload.posters, [poster]);
    } else {
      assert.equal(res.status, 307, prefix);
      assert.equal(res.headers.get("location"), poster);
    }
  }
});
