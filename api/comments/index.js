import { db } from "../../lib/db.js";
import { getProblemByKey } from "../../lib/catalog.js";
import { json, methodNotAllowed, validOrigin } from "../../lib/http.js";
import { consumeRateLimit, verifyAccess } from "../../lib/session.js";

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return methodNotAllowed(response, ['GET', 'POST']);
  const session = await verifyAccess(request);
  if (!session?.groupId) return json(response, 403, { error: "Join a team to use comments" });
  if (request.method === "POST" && !validOrigin(request)) return json(response, 403, { error: "Invalid origin" });
  if (!await consumeRateLimit(session.sessionId, "comments", request.method === "POST" ? 10 : 30, 60)) return json(response, 429, { error: "Too many comment requests" });
  const problemKey = String(request.query.problem || request.query.ps || "").trim();
  if (!getProblemByKey(problemKey)) return json(response, 400, { error: "Invalid problem key" });
  const sql = db();
  if (request.method === 'GET') {
    const rows = await sql`SELECT id, display_name, body, created_at FROM group_comments WHERE group_key = ${session.groupId} AND problem_key = ${problemKey} ORDER BY created_at DESC LIMIT 100`;
    return json(response, 200, { comments: rows });
  }
  const body = String(request.body?.body || "").trim();
  const displayName = session.displayName || "Team member";
  if (!body || body.length > 2000) return json(response, 400, { error: "Comment must be between 1 and 2000 characters" });
  const rows = await sql`INSERT INTO group_comments (group_key, problem_key, display_name, body) VALUES (${session.groupId}, ${problemKey}, ${displayName.slice(0, 40)}, ${body}) RETURNING id, display_name, body, created_at`;
  return json(response, 201, { comment: rows[0] });
}
