import { db } from "../lib/db.js";
import { getProblemByKey } from "../lib/catalog.js";
import { json, methodNotAllowed, validOrigin } from "../lib/http.js";
import { consumeRateLimit, verifyAccess } from "../lib/session.js";

const READING = new Set(["to-read", "read"]);
const DECISIONS = new Set(["keep", "accept", "reject"]);
const VOTES = new Set(["yes", "maybe", "no"]);

const readChoice = (value, allowed) => allowed.has(value) ? value : "";

function baseReview() {
  return { reading: "", decision: "", privateNote: "" };
}

function emptyVoteSummary() {
  return { yes: 0, maybe: 0, no: 0, total: 0 };
}

function reviewRow(row) {
  return { reading: row.reading_status || "", decision: row.decision_status || "", privateNote: row.private_note || "" };
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
  const session = await verifyAccess(request);
  if (!session) return json(response, 401, { error: "Access token required" });
  if (request.method === "POST" && !validOrigin(request)) return json(response, 403, { error: "Invalid origin" });
  if (!await consumeRateLimit(session.sessionId, "reviews", request.method === "POST" ? 20 : 60, 60)) return json(response, 429, { error: "Too many requests" });

  const ids = String(request.query.ids || "").split(",").map((id) => id.trim()).filter((id) => getProblemByKey(id)).slice(0, 100);
  const sql = db();
  if (request.method === "GET" && ids.length) {
    const [rows, votes] = await Promise.all([
      sql`SELECT problem_key, reading_status, decision_status, private_note
        FROM user_problem_reviews WHERE user_id = ${session.sessionId} AND problem_key = ANY(${ids})`,
      session.groupId
        ? sql`SELECT problem_key, vote FROM team_problem_votes WHERE team_id = ${session.groupId} AND user_id = ${session.sessionId} AND problem_key = ANY(${ids})`
        : Promise.resolve([]),
    ]);
    const byId = Object.fromEntries(rows.map((row) => [row.problem_key, reviewRow(row)]));
    for (const vote of votes) byId[vote.problem_key] = { ...(byId[vote.problem_key] || baseReview()), vote: vote.vote };
    return json(response, 200, {
      reviews: byId,
    });
  }

  const problemKey = String(request.query.problem || request.query.ps || "").trim();
  if (!getProblemByKey(problemKey)) return json(response, 400, { error: "Invalid problem key" });

  if (request.method === "GET") {
    const [reviews, votes] = await Promise.all([
      sql`SELECT reading_status, decision_status, private_note FROM user_problem_reviews WHERE user_id = ${session.sessionId} AND problem_key = ${problemKey}`,
      session.groupId
        ? sql`SELECT vote, COUNT(*)::int AS count FROM team_problem_votes WHERE team_id = ${session.groupId} AND problem_key = ${problemKey} GROUP BY vote`
        : Promise.resolve([]),
    ]);
    const mine = session.groupId
      ? await sql`SELECT vote FROM team_problem_votes WHERE team_id = ${session.groupId} AND user_id = ${session.sessionId} AND problem_key = ${problemKey}`
      : [];
    const review = reviews.length ? reviewRow(reviews[0]) : baseReview();
    const summary = votes.reduce((acc, row) => {
      acc[row.vote] = row.count;
      acc.total += row.count;
      return acc;
    }, emptyVoteSummary());
    return json(response, 200, { review, vote: mine[0]?.vote || "", votes: summary });
  }

  const reading = readChoice(String(request.body?.reading || ""), READING);
  const decision = readChoice(String(request.body?.decision || ""), DECISIONS);
  const privateNote = String(request.body?.privateNote || "").trim();
  const vote = readChoice(String(request.body?.vote || ""), VOTES);
  if (privateNote.length > 4000) return json(response, 400, { error: "Private note must be 0 to 4000 characters" });
  if (reading || decision || privateNote) {
    await sql`INSERT INTO user_problem_reviews (user_id, problem_key, reading_status, decision_status, private_note, updated_at)
      VALUES (${session.sessionId}, ${problemKey}, ${reading || null}, ${decision || null}, ${privateNote}, NOW())
      ON CONFLICT (user_id, problem_key)
      DO UPDATE SET reading_status = EXCLUDED.reading_status, decision_status = EXCLUDED.decision_status,
        private_note = EXCLUDED.private_note, updated_at = NOW()`;
  } else {
    await sql`DELETE FROM user_problem_reviews WHERE user_id = ${session.sessionId} AND problem_key = ${problemKey}`;
  }

  if (request.body && Object.hasOwn(request.body, "vote")) {
    if (!session.groupId && vote) return json(response, 403, { error: "Join a team to vote" });
    if (session.groupId) {
      if (vote) {
        await sql`INSERT INTO team_problem_votes (team_id, user_id, problem_key, vote, updated_at)
          VALUES (${session.groupId}, ${session.sessionId}, ${problemKey}, ${vote}, NOW())
          ON CONFLICT (team_id, user_id, problem_key)
          DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW()`;
      } else {
        await sql`DELETE FROM team_problem_votes WHERE team_id = ${session.groupId} AND user_id = ${session.sessionId} AND problem_key = ${problemKey}`;
      }
    }
  }

  const reviews = await sql`SELECT reading_status, decision_status, private_note FROM user_problem_reviews WHERE user_id = ${session.sessionId} AND problem_key = ${problemKey}`;
  const voteRows = session.groupId
    ? await sql`SELECT vote, COUNT(*)::int AS count FROM team_problem_votes WHERE team_id = ${session.groupId} AND problem_key = ${problemKey} GROUP BY vote`
    : [];
  const mine = session.groupId
    ? await sql`SELECT vote FROM team_problem_votes WHERE team_id = ${session.groupId} AND user_id = ${session.sessionId} AND problem_key = ${problemKey}`
    : [];
  const summary = voteRows.reduce((acc, row) => {
    acc[row.vote] = row.count;
    acc.total += row.count;
    return acc;
  }, emptyVoteSummary());
  return json(response, 200, {
    review: reviews.length ? reviewRow(reviews[0]) : baseReview(),
    vote: mine[0]?.vote || "",
    votes: summary,
  });
}
