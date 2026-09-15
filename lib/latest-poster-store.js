import fs from "node:fs/promises";
import path from "node:path";
import { getCacheDirectory } from "./cache-utils.js";

const DEFAULT_KEY = "movie-poster-scraper:latest-poster";
const DEFAULT_TIMEOUT_MS = 2000;

export class LatestPosterStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "LatestPosterStorageError";
  }
}

function timeoutMs(env) {
  const value = Number(env.LATEST_POSTER_STORAGE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function redisConfiguration(env) {
  return {
    url: env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL,
    token: env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN,
    key: env.LATEST_POSTER_REDIS_KEY || DEFAULT_KEY,
  };
}

export function createRedisLatestPosterAdapter({ url, token, key = DEFAULT_KEY, fetchImpl = fetch }) {
  const request = async (command, value) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(value === undefined ? [command, key] : [command, key, value]),
    });
    if (!response.ok) throw new Error(`Redis REST request failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Redis REST error: ${payload.error}`);
    return payload.result;
  };

  return {
    async get() {
      const value = await request("GET");
      if (value === null || value === undefined) return null;
      return typeof value === "string" ? JSON.parse(value) : value;
    },
    async set(record) {
      await request("SET", JSON.stringify(record));
    },
  };
}

export function createFileLatestPosterAdapter({ file = path.join(getCacheDirectory({}), "latest.json"), fileSystem = fs } = {}) {
  return {
    async get() {
      try {
        return JSON.parse(await fileSystem.readFile(file, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
    async set(record) {
      await fileSystem.mkdir(path.dirname(file), { recursive: true });
      await fileSystem.writeFile(file, JSON.stringify(record, null, 2));
    },
  };
}

export function createLatestPosterAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  const config = redisConfiguration(env);
  if (config.url && config.token) return createRedisLatestPosterAdapter({ ...config, fetchImpl });

  const deployed = Boolean(env.VERCEL || env.NOW_REGION || env.NODE_ENV === "production");
  if (deployed) {
    return {
      async get() { throw new Error("Shared latest-poster storage is not configured"); },
      async set() { throw new Error("Shared latest-poster storage is not configured"); },
    };
  }
  return createFileLatestPosterAdapter();
}

function withTimeout(operation, milliseconds) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`operation timed out after ${milliseconds}ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createLatestPosterStore({ adapter = createLatestPosterAdapter(), env = process.env, now = () => new Date() } = {}) {
  const milliseconds = timeoutMs(env);
  return {
    async getLatestPoster() {
      try {
        return await withTimeout(() => adapter.get(), milliseconds);
      } catch (error) {
        throw new LatestPosterStorageError("Latest-poster storage is unavailable", error);
      }
    },
    async saveLatestPoster(title, urlOrObject) {
      const url = typeof urlOrObject === "string" ? urlOrObject : urlOrObject?.url;
      if (!url) return null;
      const record = { title, url, timestamp: now().toISOString() };
      try {
        await withTimeout(() => adapter.set(record), milliseconds);
        return record;
      } catch (error) {
        throw new LatestPosterStorageError("Latest-poster storage is unavailable", error);
      }
    },
  };
}

export const latestPosterStore = createLatestPosterStore();

export async function saveLatestPosterSafely(store, title, poster, logger = console) {
  try {
    await store.saveLatestPoster(title, poster);
  } catch (error) {
    logger.error("Failed to persist latest poster:", error.message, error.cause?.message || "");
  }
}
