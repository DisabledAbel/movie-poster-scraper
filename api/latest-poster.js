import { getLatestPoster } from "../lib/cache-utils.js";

export default async function handler(req, res) {
  const latest = getLatestPoster();

  if (!latest || !latest.url) {
    return res.status(404).json({ error: "No latest poster found" });
  }

  // Support JSON response for UI
  if (req.query && req.query.json === "1") {
    return res.status(200).json(latest);
  }

  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return res.redirect(307, latest.url);
}
