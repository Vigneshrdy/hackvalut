import { methodNotAllowed } from "../lib/http.js";
import { getHackathons, getProblems } from "../lib/catalog.js";

const ORIGIN = (process.env.APP_ORIGIN || "").split(",")[0].trim() || "https://example.com";

let xml;

function url(loc, priority) {
  return `  <url>\n    <loc>${loc}</loc>\n    <priority>${priority}</priority>\n  </url>`;
}

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  if (!xml) {
    const hackathons = getHackathons();
    const problems = getProblems();
    xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url(`${ORIGIN}/`, "1.0"),
      url(`${ORIGIN}/hackathons`, "0.95"),
      ...hackathons.flatMap((hackathon) => [
        url(`${ORIGIN}/hackathons/${encodeURIComponent(hackathon.id)}`, "0.9"),
        ...hackathon.editions.map((edition) => url(`${ORIGIN}/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}`, "0.85")),
      ]),
      ...problems.map((problem) => url(`${ORIGIN}/hackathons/${encodeURIComponent(problem.hackathon.id)}/${encodeURIComponent(problem.edition.id)}/problems/${encodeURIComponent(problem.id)}`, "0.8")),
      "</urlset>",
    ].join("\n");
  }
  response.status(200);
  response.setHeader("Content-Type", "application/xml; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return response.send(xml);
}
