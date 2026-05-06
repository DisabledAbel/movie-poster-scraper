import http from "http";
import handler from "./api/scrape.js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname !== "/") {
      return sendJson(res, 404, { error: "Not found" });
    }

    const movie = (requestUrl.searchParams.get("q") || "").trim();
    if (!movie) {
      return sendJson(res, 400, { error: "Missing q parameter" });
    }

    const year = requestUrl.searchParams.get("year") || undefined;

    const reqShim = { query: { movie, year } };
    const resShim = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        sendJson(res, this.statusCode || 200, payload);
      },
    };

    await handler(reqShim, resShim);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
});
