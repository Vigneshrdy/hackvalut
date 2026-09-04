import crypto from "node:crypto";
import { db } from "../lib/db.js";
import { json, methodNotAllowed, validOrigin } from "../lib/http.js";
import { TEAM_MAX_MEMBERS, consumeRateLimit, consumeThrottle, teamSummary, throttleExceeded, verifyAccess } from "../lib/session.js";

const NAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(":");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length || 32);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function readName(value, min, max) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name.length >= min && name.length <= max && NAME_PATTERN.test(name) ? name : "";
}

// Takes the lowest free seat rather than MAX(seat) + 1, so a seat vacated by a
// member who left is reused instead of shrinking the team's capacity for good.
// generate_series bounds the search to 6; CHECK (seat BETWEEN 1 AND 6) and
// UNIQUE (team_id, seat) are the database's own backstop against a direct write.
async function claimSeat(sql, teamId, userId, displayName, isLead) {
  const existing = await sql`SELECT team_id FROM team_members WHERE user_id = ${userId}`;
  if (existing.length) return existing[0].team_id === teamId ? "duplicate" : "other-team";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const rows = await sql`INSERT INTO team_members (team_id, user_id, display_name, is_lead, seat)
        SELECT ${teamId}, ${userId}, ${displayName}, ${isLead}, free.seat
        FROM generate_series(1, ${TEAM_MAX_MEMBERS}) AS free(seat)
        WHERE NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = ${teamId} AND m.seat = free.seat)
        ORDER BY free.seat LIMIT 1
        ON CONFLICT (team_id, user_id) DO NOTHING RETURNING seat`;
      if (rows.length) return "joined";
      // No free seat, or this user was inserted concurrently by another request.
      const now = await sql`SELECT team_id FROM team_members WHERE user_id = ${userId}`;
      return now.length ? "duplicate" : "full";
    } catch (error) {
      if (error.code === "23514") return "full";                       // seat outside 1..6
      if (error.code === "23505" && error.constraint === "team_members_single_team_idx") return "other-team";
      if (error.code !== "23505") throw error;                          // not a seat race
    }
  }
  return "full";
}

// A team must always have exactly one lead. When the lead leaves, the remaining
// member with the lowest seat inherits it; an emptied team is removed outright so
// no leaderless team is left behind for someone to join.
async function releaseSeat(sql, userId) {
  const gone = await sql`DELETE FROM team_members WHERE user_id = ${userId} RETURNING team_id, is_lead`;
  await sql`UPDATE browse_sessions SET group_key = NULL WHERE id = ${userId}`;
  if (!gone.length) return;
  const teamId = gone[0].team_id;
  if (gone[0].is_lead) {
    const heir = await sql`UPDATE team_members SET is_lead = TRUE
      WHERE team_id = ${teamId} AND seat = (SELECT MIN(seat) FROM team_members WHERE team_id = ${teamId})
      RETURNING display_name, user_id`;
    if (heir.length) await sql`UPDATE teams SET leader_name = ${heir[0].display_name}, leader_id = ${heir[0].user_id} WHERE id = ${teamId}`;
  }
  const remaining = await sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} LIMIT 1`;
  if (!remaining.length) await sql`DELETE FROM teams WHERE id = ${teamId}`;
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
  const session = await verifyAccess(request);
  if (!session) return json(response, 401, { error: "Sign in to manage teams" });

  const sql = db();
  if (request.method === "GET") {
    if (!await consumeRateLimit(session.sessionId, "team-read", 60, 60)) return json(response, 429, { error: "Too many requests" });
    return json(response, 200, { team: await teamSummary(session.groupId) });
  }

  if (!validOrigin(request)) return json(response, 403, { error: "Invalid origin" });
  if (!await consumeRateLimit(session.sessionId, "team", 10, 900)) return json(response, 429, { error: "Too many team attempts" });

  const { action, teamName, teamPassword, displayName } = request.body || {};
  if (action === "leave") {
    await releaseSeat(sql, session.sessionId);
    return json(response, 200, { team: null });
  }
  if (action !== "create" && action !== "join") return json(response, 400, { error: "Choose create or join" });

  const name = readName(teamName, 3, 40);
  if (!name) return json(response, 400, { error: "Team name must be 3 to 40 letters, numbers, spaces, . _ or -" });
  const member = readName(displayName, 2, 40);
  if (!member) return json(response, 400, { error: `Enter a ${action === "create" ? "team lead" : "member"} name between 2 and 40 characters` });
  const password = String(teamPassword ?? "");
  if (password.length < 6 || password.length > 72) return json(response, 400, { error: "Team password must be 6 to 72 characters" });

  const nameKey = name.toLowerCase();
  let teamId;
  if (action === "create") {
    const created = await sql`INSERT INTO teams (id, name, name_key, password_hash, leader_name, leader_id)
      VALUES (${crypto.randomBytes(12).toString("hex")}, ${name}, ${nameKey}, ${hashPassword(password)}, ${member}, ${session.sessionId})
      ON CONFLICT (name_key) DO NOTHING RETURNING id`;
    if (!created.length) return json(response, 409, { error: "That team name is already taken" });
    teamId = created[0].id;
  } else {
    // The per-session limit above is bypassable by registering more accounts, so the
    // guess rate is also capped per team name. Only wrong passwords count, so a team
    // legitimately filling its six seats never throttles itself.
    const guessKey = `team-join-fail:${nameKey}`;
    if (await throttleExceeded(guessKey, 12, 900)) return json(response, 429, { error: "Too many failed attempts for this team. Try again later." });
    const found = await sql`SELECT id, password_hash FROM teams WHERE name_key = ${nameKey}`;
    if (!found.length || !verifyPassword(password, found[0].password_hash)) {
      await consumeThrottle(guessKey, 12, 900);
      return json(response, 403, { error: "Invalid team name or password" });
    }
    teamId = found[0].id;
  }

  const outcome = await claimSeat(sql, teamId, session.sessionId, member, action === "create");
  if (outcome === "full") {
    if (action === "create") await sql`DELETE FROM teams WHERE id = ${teamId}`;
    return json(response, 409, { error: `Team is full — maximum ${TEAM_MAX_MEMBERS} members allowed.` });
  }
  if (outcome === "duplicate") return json(response, 409, { error: "You are already a member of this team" });
  if (outcome === "other-team") {
    if (action === "create") await sql`DELETE FROM teams WHERE id = ${teamId}`;
    return json(response, 409, { error: "Leave your current team before joining another one" });
  }

  await sql`UPDATE browse_sessions SET group_key = ${teamId}, display_name = ${member} WHERE id = ${session.sessionId}`;
  return json(response, action === "create" ? 201 : 200, { team: await teamSummary(teamId) });
}
