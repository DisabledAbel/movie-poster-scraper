import fs from "fs";
import path from "path";
import { fetchPostersForTitle } from "./utils.js";

const CACHE_DIR = path.resolve(".cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

export default async function handler(req, res) {
  try {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Missing title" });

    const safeFile = path.join(CACHE_DIR, `${title.toLowerCase()}.json`);

    if (fs.existsSync(safeFile)) {
      const data = JSON.parse(fs.readFileSync(safeFile, "utf-8"));
      return res.status(200).json(data);
    }

    const posters = await fetchPostersForTitle(title);

    fs.writeFileSync(safeFile, JSON.stringify({ title, posters }));

    res.status(200).json({ title, posters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
