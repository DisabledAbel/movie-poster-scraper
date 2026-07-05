import { getLatestPoster } from "../lib/cache-utils.js";

export default async function handler(req, res) {
  const latest = getLatestPoster();

  if (latest && latest.url) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.redirect(307, latest.url);
  }

  // Fallback if no latest poster is found
  return res.status(404).json({ error: "No latest poster found" });
}
