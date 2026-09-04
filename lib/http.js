export function json(response, status, body) {
  response.status(status);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  return response.json(body);
}

export function methodNotAllowed(response, methods) {
  response.setHeader("Allow", methods.join(", "));
  return json(response, 405, { error: "Method not allowed" });
}

export function parseCookies(request) {
  const jar = {};
  for (const part of (request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;                       // skip malformed pairs
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      jar[name] = decodeURIComponent(part.slice(index + 1));
    } catch {
      jar[name] = part.slice(index + 1);           // keep a badly encoded value usable
    }
  }
  return jar;
}

export function requestIp(request) {
  return (request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || "").split(",")[0].trim();
}

export function validOrigin(request) {
  const allowed = (process.env.APP_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean);
  // With no APP_ORIGIN configured there is nothing to compare against, so allow the
  // request rather than breaking a local run that has not set it.
  if (!allowed.length) return true;
  // Browsers always send Origin on the state-changing requests this guards, so a
  // missing header is not a browser being helpful -- it is the check being skipped.
  return allowed.includes(request.headers.origin);
}
