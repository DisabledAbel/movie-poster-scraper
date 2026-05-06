export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    return res.status(200).json({ status: "ok" });
  } catch {
    return res.status(500).json({ status: "error" });
  }
}
