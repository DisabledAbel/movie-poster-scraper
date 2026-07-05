import http from "http";
import scrapeHandler from "./api/scrape.js";
import posterHandler from "./api/poster.js";
import searchHandler from "./api/search.js";
import latestPosterHandler from "./api/latest-poster.js";
import posterImgHandler from "./api/poster-img/[title].js";
import posterByTitleHandler from "./api/poster/[title].js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;

    const resShim = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
        res.setHeader(name, value);
        return this;
      },
      status(code) {
        this.statusCode = code;
        res.statusCode = code;
        return this;
      },
      json(payload) {
        sendJson(res, this.statusCode, payload);
      },
      redirect(status, url) {
        if (typeof status === "string") {
          url = status;
          status = 307;
        }
        res.statusCode = status;
        res.setHeader("Location", url);
        res.end();
      },
    };

    if (pathname === "/") {
      const movie = (requestUrl.searchParams.get("q") || "").trim();
      if (!movie) return sendJson(res, 400, { error: "Missing q parameter" });
      const year = requestUrl.searchParams.get("year") || undefined;
      return await scrapeHandler({ query: { movie, year } }, resShim);
    }

    if (pathname === "/api/scrape") {
      const movie = requestUrl.searchParams.get("movie");
      const year = requestUrl.searchParams.get("year");
      return await scrapeHandler({ query: { movie, year } }, resShim);
    }

    if (pathname === "/api/poster") {
      const movie = requestUrl.searchParams.get("movie");
      const year = requestUrl.searchParams.get("year");
      return await posterHandler({ query: { movie, year } }, resShim);
    }

    if (pathname === "/api/search") {
      const query = requestUrl.searchParams.get("query");
      const year = requestUrl.searchParams.get("year");
      return await searchHandler({ query: { query, year } }, resShim);
    }

    if (pathname === "/api/latest-poster" || pathname === "/latest-poster.jpg") {
      return await latestPosterHandler({}, resShim);
    }

    if (pathname.startsWith("/api/poster/")) {
      const title = pathname.split("/").pop();
      return await posterByTitleHandler({ query: { title } }, resShim);
    }

    if (pathname.startsWith("/api/poster-img/") || pathname.startsWith("/poster-img/")) {
      let title = pathname.split("/").pop();
      if (title.endsWith(".jpg")) title = title.slice(0, -4);
      return await posterImgHandler({ query: { title } }, resShim);
    }

    if (pathname.startsWith("/poster/")) {
      const title = pathname.split("/").pop();
      return await posterByTitleHandler({ query: { title } }, resShim);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
});
