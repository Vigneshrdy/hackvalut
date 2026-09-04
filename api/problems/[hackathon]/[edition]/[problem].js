import { getProblem } from "../../../../lib/catalog.js";
import { json, methodNotAllowed } from "../../../../lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const item = getProblem(String(request.query.hackathon || ""), String(request.query.edition || ""), String(request.query.problem || ""));
  if (!item) return json(response, 404, { error: "Problem not found" });
  response.status(200);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return response.json({ item });
}
