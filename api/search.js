import { normalizeYear } from "../lib/poster-utils.js";
import { findPostersSequential } from "../lib/providers.js";

export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const query = typeof req.query?.query === "string" ? req.query.query.trim() : "";
    const year = normalizeYear(req.query?.year);

    if (!query) {
      return res.status(400).json({ error: "Missing query parameter: query" });
    }

    const { posters, source, sourcesTried } = await findPostersSequential(query, year);

    if (posters && posters.length > 0) {
      return res.status(200).json({
        query,
        posters,
        image: posters[0], // backward compatibility
        source,
        sourcesTried
      });
    }

    return res.status(404).json({ query, error: "No image found" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
