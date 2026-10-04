/**
 * Find direct JPG/JPEG movie poster URLs.
 *
 * Usage:
 *   node firecrawl-movie-posters.js "The Matrix"
 *   node firecrawl-movie-posters.js "The Matrix" --save
 *   node firecrawl-movie-posters.js "The Matrix" --save --output ./posters/matrix.jpg
 *
 * Optional:
 *   FIRECRAWL_API_KEY=your_key node firecrawl-movie-posters.js "The Matrix"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeYear } from "./lib/poster-utils.js";
import { findPostersSequential } from "./lib/providers.js";

/**
 * Search providers for movie posters and return the top 15 JPG URLs.
 * Firecrawl is optional and used only when FIRECRAWL_API_KEY is set.
 * @param {string} title
 * @param {number|null} year
 * @returns {Promise<string[]>}
 */
async function getMoviePosters(title, year = null) {
  if (!title || !title.trim()) {
    throw new Error("A movie title is required.");
  }

  const { posters } = await findPostersSequential(title.trim(), year);
  return posters.filter((url) => /\.jpe?g(?:$|[?#])/i.test(url));
}

function sanitizeForFilename(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function defaultOutputPathFromTitle(title) {
  const safeTitle = sanitizeForFilename(title) || "movie-poster";
  return path.join(process.cwd(), `${safeTitle}.jpg`);
}

async function downloadPosterToFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}) from ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!/image\/jpe?g/i.test(contentType) && !/\.jpe?g(?:$|[?#])/i.test(url)) {
    throw new Error(`Downloaded file is not JPG/JPEG (content-type: ${contentType || "unknown"}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, buffer);

  return resolvedOutputPath;
}

function parseCliArgs(argv) {
  const options = {
    save: false,
    output: null,
    index: 0,
    year: null,
  };
  const titleParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--save") {
      options.save = true;
      continue;
    }

    if (token === "--output") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --output");
      }
      options.output = value;
      i += 1;
      continue;
    }

    if (token === "--index") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --index");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--index must be a non-negative integer");
      }
      options.index = parsed;
      i += 1;
      continue;
    }

    if (token === "--year") {
      const value = argv[i + 1];
      const year = /^\d{4}$/.test(value || "") ? normalizeYear(value) : null;
      if (year === null) throw new Error("--year must be a four-digit release year between 1888 and 3000");
      options.year = year;
      i += 1;
      continue;
    }

    titleParts.push(token);
  }

  return {
    title: titleParts.join(" ").trim(),
    options,
  };
}

export { getMoviePosters };

const currentFilePath = fileURLToPath(import.meta.url);
const isExecutedDirectly = process.argv[1] && path.resolve(process.argv[1]) === currentFilePath;

if (isExecutedDirectly) {
  (async () => {
    try {
      const { title, options } = parseCliArgs(process.argv.slice(2));
      const posters = await getMoviePosters(title, options.year);

      if (!posters.length) {
        console.log(`No JPG posters found for "${title}".`);
        process.exitCode = 1;
        return;
      }

      if (options.save) {
        const selectedPoster = posters[options.index] || posters[0];
        const outputPath = options.output || defaultOutputPathFromTitle(title);
        const savedPath = await downloadPosterToFile(selectedPoster, outputPath);

        console.log(
          JSON.stringify(
            {
              title,
              posterUrl: selectedPoster,
              savedTo: savedPath,
            },
            null,
            2
          )
        );
        return;
      }

      console.log(JSON.stringify(posters, null, 2));
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  })();
}
