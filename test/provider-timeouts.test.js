import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchImdbPosterCandidates,
  findPostersSequential,
  runProviderWithDeadline,
} from "../lib/providers.js";

const poster = (name) => `https://images.example.com/${name}.jpg`;
const stalled = () => new Promise(() => {});

test("a stalled IMDb provider times out and a later provider succeeds", async () => {
  const result = await findPostersSequential("Movie", null, {
    providers: [
      { name: "imdb", fetcher: stalled },
      { name: "itunes", fetcher: async () => [poster("later")] },
    ],
    providerTimeoutMs: 10,
    overallTimeoutMs: 50,
  });

  assert.deepEqual(result, {
    posters: [poster("later")],
    source: "itunes",
    sourcesTried: ["itunes"],
  });
});

test("a later timeout preserves posters already collected", async () => {
  const result = await findPostersSequential("Movie", null, {
    providers: [
      { name: "imdb", fetcher: async () => [] },
      { name: "itunes", fetcher: async () => [poster("collected")] },
      { name: "wikipedia", fetcher: stalled },
    ],
    providerTimeoutMs: 10,
    overallTimeoutMs: 60,
  });

  assert.deepEqual(result.posters, [poster("collected")]);
  assert.equal(result.source, "itunes");
  assert.deepEqual(result.sourcesTried, ["itunes", "wikipedia"]);
});

test("all stalled providers produce a bounded response and stop at the overall deadline", async () => {
  const started = [];
  const providers = ["imdb", "one", "two", "not-started"].map((name) => ({
    name,
    fetcher: () => {
      started.push(name);
      return stalled();
    },
  }));
  const beganAt = Date.now();
  const result = await findPostersSequential("Movie", null, {
    providers,
    providerTimeoutMs: 20,
    overallTimeoutMs: 35,
  });

  assert.ok(Date.now() - beganAt < 150, "search exceeded its bounded deadline");
  assert.deepEqual(result.posters, []);
  assert.deepEqual(started, ["imdb", "one"]);
});

test("a stalled response body is covered and its fetch signal is aborted", async (t) => {
  const originalFetch = globalThis.fetch;
  let receivedSignal;
  let aborted = false;
  globalThis.fetch = async (_url, { signal } = {}) => {
    receivedSignal = signal;
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    return { ok: true, json: stalled };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await findPostersSequential("Movie", null, {
    providers: [
      {
        name: "imdb",
        fetcher: (context) => fetchImdbPosterCandidates("Movie", null, context),
      },
      { name: "itunes", fetcher: async () => [poster("fallback")] },
    ],
    providerTimeoutMs: 10,
    overallTimeoutMs: 50,
  });

  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(aborted, true);
  assert.deepEqual(result.posters, [poster("fallback")]);
});

test("fast successful searches retain IMDb priority and response fields", async () => {
  const result = await findPostersSequential("Movie", null, {
    providers: [
      { name: "tmdb", fetcher: async () => [poster("tmdb")] },
      { name: "imdb", fetcher: async () => [poster("imdb")] },
      { name: "itunes", fetcher: async () => [poster("itunes")] },
    ],
    providerTimeoutMs: 50,
    overallTimeoutMs: 200,
  });

  assert.equal(result.posters[0], poster("imdb"));
  assert.deepEqual(new Set(result.posters), new Set([
    poster("imdb"), poster("tmdb"), poster("itunes"),
  ]));
  assert.equal(result.source, "imdb");
  assert.deepEqual(result.sourcesTried, ["tmdb", "itunes"]);
});

test("deadline helper clears its timer after success and timeout", async () => {
  const activeTimers = new Set();
  const setTimer = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    activeTimers.add(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    activeTimers.delete(timer);
    clearTimeout(timer);
  };

  assert.deepEqual(await runProviderWithDeadline(async () => ["ok"], {
    timeoutMs: 20,
    setTimer,
    clearTimer,
  }), ["ok"]);
  assert.equal(activeTimers.size, 0);

  await assert.rejects(runProviderWithDeadline(stalled, {
    timeoutMs: 5,
    setTimer,
    clearTimer,
  }), /timed out/);
  assert.equal(activeTimers.size, 0);
});
