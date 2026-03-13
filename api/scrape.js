import { fetchPostersForTitle } from "./poster/utils.js";

export default async function handler(req, res) {
  try {
    const movie = req.query.movie || "inception";
    const posters = await fetchPostersForTitle(movie);

    res.status(200).json({
      movie,
      posters,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
