import { rotateSession } from "../../lib/session.js";
import { json, methodNotAllowed, validOrigin } from "../../lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  if (!validOrigin(request)) return json(response, 403, { error: "Invalid origin" });
  const tokens = await rotateSession(request, response);
  return tokens ? json(response, 200, tokens) : json(response, 401, { error: "Session expired" });
}
