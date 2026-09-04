import { getHackathons } from "../../lib/catalog.js";
import { methodNotAllowed } from "../../lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const items = getHackathons().map((hackathon) => ({
    ...hackathon,
    editions: hackathon.editions.map((edition) => ({
      id: edition.id,
      name: edition.name,
      year: edition.year,
      status: edition.status,
      description: edition.description,
      problemCount: edition.stats.problems,
      href: `/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}`,
    })),
    problemCount: hackathon.stats.problems,
    href: `/hackathons/${encodeURIComponent(hackathon.id)}`,
  }));
  response.status(200);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return response.json({ items, total: items.length });
}
