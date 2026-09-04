import { methodNotAllowed } from "../../lib/http.js";
import { getHackathons, getMetadata, getProblems } from "../../lib/catalog.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const items = getProblems({
    hackathon: String(request.query.hackathon || ""),
    edition: String(request.query.edition || ""),
    organization: String(request.query.organization || ""),
    department: String(request.query.department || ""),
    category: String(request.query.category || ""),
    theme: String(request.query.theme || ""),
    tag: String(request.query.tag || ""),
    hasDataset: String(request.query.hasDataset || ""),
    q: String(request.query.q || ""),
  });
  response.status(200);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return response.json({ items, total: items.length, hackathons: getHackathons(), metadata: getMetadata() });
}
