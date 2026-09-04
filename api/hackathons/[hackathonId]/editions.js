import { getEditions, getHackathon } from "../../../lib/catalog.js";
import { json, methodNotAllowed } from "../../../lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const hackathonId = String(request.query.hackathonId || "").trim();
  const hackathon = getHackathon(hackathonId);
  if (!hackathon) return json(response, 404, { error: "Hackathon not found" });
  const items = getEditions(hackathonId).map((edition) => ({
    ...edition,
    problemCount: edition.stats.problems,
    href: `/hackathons/${encodeURIComponent(hackathonId)}/${encodeURIComponent(edition.id)}`,
  }));
  response.status(200);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return response.json({ hackathon: { id: hackathon.id, name: hackathon.name, short_name: hackathon.short_name }, items, total: items.length });
}
