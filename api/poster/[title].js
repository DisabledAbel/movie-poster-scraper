import fs from "fs";
import path from "path";
import { findPostersSequential } from "../../lib/providers.js";
import { getCacheDirectory } from "../../lib/cache-utils.js";

export function createPosterHandler({
  findPosters = findPostersSequential,
  cacheDir = getCacheDirectory(),
  fileSystem = fs,
} = {}) {
  return async function handler(req, res) {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });

    const safeFile = path.join(cacheDir, `${title.toLowerCase()}.json`);

    try {
      const data = JSON.parse(fileSystem.readFileSync(safeFile, "utf-8"));
      return res.status(200).json(data);
    } catch (err) {
      // A cache miss or an unreadable/malformed entry must not affect the lookup.
    }

    try {
      const result = await findPosters(title, null);
      const payload = { title, ...result };

      try {
        fileSystem.mkdirSync(cacheDir, { recursive: true });
        fileSystem.writeFileSync(safeFile, JSON.stringify(payload));
      } catch (err) {
        // Caching is best-effort; the provider result is still a successful response.
      }

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export default createPosterHandler();
