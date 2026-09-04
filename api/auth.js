import crypto from "node:crypto";
import { consumeThrottle, endSession, endSessionByRefreshToken, signInUser, signUpUser, throttleExceeded, verifyAccess } from "../lib/session.js";
import { json, methodNotAllowed, requestIp, validOrigin } from "../lib/http.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WINDOW_SECONDS = 900;
// Guessing one account's password is capped tightly. The per-address ceiling is loose
// on purpose: it exists to stop mass enumeration from a single host, not to let one
// attacker on a shared campus address lock everybody else out.
const PER_ACCOUNT_FAILURES = 10;
const PER_ADDRESS_FAILURES = 150;
const digest = (value) => crypto.createHash("sha256").update(value || "unknown").digest("hex").slice(0, 32);

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  if (!validOrigin(request)) return json(response, 403, { error: "Invalid origin" });

  const { action, email, password } = request.body || {};

  if (action === "logout") {
    const session = await verifyAccess(request);
    if (session?.sessionId) await endSession(session.sessionId, response);
    else await endSessionByRefreshToken(request, response);
    return json(response, 200, { ok: true });
  }
  if (action !== "login" && action !== "signup") return json(response, 400, { error: "Unknown action" });

  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(address) || address.length > 254) return json(response, 400, { error: "Enter a valid email address" });
  const secret = String(password ?? "");
  if (secret.length < 8 || secret.length > 72) return json(response, 400, { error: "Password must be 8 to 72 characters" });

  // There is no session to rate-limit against yet, so failures are counted per
  // account and per client address. Successes never count, so normal sign-ins from a
  // shared address stay unaffected.
  const ip = requestIp(request);
  const accountKey = `auth-fail:${digest(ip)}:${digest(address)}`;
  const addressKey = `auth-fail-ip:${digest(ip)}`;
  if (await throttleExceeded(accountKey, PER_ACCOUNT_FAILURES, WINDOW_SECONDS)
    || await throttleExceeded(addressKey, PER_ADDRESS_FAILURES, WINDOW_SECONDS)) {
    return json(response, 429, { error: "Too many failed attempts. Wait a few minutes and try again." });
  }

  const metadata = { ip, userAgent: request.headers["user-agent"] };
  const result = action === "signup"
    ? await signUpUser(response, address, secret, metadata)
    : await signInUser(response, address, secret, metadata);

  if (result.error) {
    await consumeThrottle(accountKey, PER_ACCOUNT_FAILURES, WINDOW_SECONDS);
    await consumeThrottle(addressKey, PER_ADDRESS_FAILURES, WINDOW_SECONDS);
    return json(response, 403, { error: result.error });
  }
  if (result.pending) return json(response, 202, { pending: true, message: "Check your email to confirm the account, then log in." });
  return json(response, action === "signup" ? 201 : 200, result);
}
