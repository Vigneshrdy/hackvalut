import assert from "node:assert/strict";
import crypto from "node:crypto";
import { closeDb, db } from "../../lib/db.js";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const ORIGIN = new URL(BASE_URL).origin;
const PASSWORD = "DiagPassword123!";
const sql = db();

const state = {
  userIds: [],
  emails: [],
  teamIds: new Set(),
};

class Client {
  constructor(name) {
    this.name = name;
    this.cookies = [];
    this.accessToken = "";
    this.email = "";
    this.id = "";
  }

  cookieHeader(path) {
    return this.cookies
      .filter((cookie) => path.startsWith(cookie.path))
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  storeCookies(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const header of setCookies) {
      const parts = header.split(";").map((part) => part.trim());
      const [pair] = parts;
      const index = pair.indexOf("=");
      if (index < 1) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const path = parts.find((part) => part.startsWith("Path="))?.slice(5) || "/";
      this.cookies = this.cookies.filter((cookie) => !(cookie.name === name && cookie.path === path));
      if (value) this.cookies.push({ name, value, path });
    }
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.json !== undefined) headers.set("Content-Type", "application/json");
    if (options.origin !== false) headers.set("Origin", ORIGIN);
    const cookie = this.cookieHeader(path);
    if (cookie) headers.set("Cookie", cookie);
    if (this.accessToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.json === undefined ? options.body : JSON.stringify(options.json),
    });
    this.storeCookies(response);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body, headers: response.headers };
  }

  async login(email, password = PASSWORD) {
    const result = await this.request("/api/auth", { method: "POST", json: { action: "login", email, password } });
    if (result.status === 200) {
      this.accessToken = result.body.accessToken;
      this.email = result.body.email;
      this.id = decodeJwt(result.body.accessToken).sub;
    }
    return result;
  }

  async refresh() {
    const result = await this.request("/api/session/refresh", { method: "POST" });
    if (result.status === 200) {
      this.accessToken = result.body.accessToken;
      this.email = result.body.email;
      this.id = decodeJwt(result.body.accessToken).sub;
    }
    return result;
  }
}

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

async function createConfirmedUser(label) {
  const email = `sih-flow-${label}-${crypto.randomBytes(4).toString("hex")}@sihcheck.local`;
  const rows = await sql`INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous
    ) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email},
      extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), NOW(), NOW(), NOW(),
      '', '', '', '', '', '', '', '', FALSE, FALSE) RETURNING id`;
  const userId = rows[0].id;
  await sql`INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (${email}, ${userId}, ${JSON.stringify({ sub: userId, email, email_verified: true, phone_verified: false })}::jsonb, 'email', NOW(), NOW(), NOW())`;
  state.userIds.push(userId);
  state.emails.push(email);
  return { email, userId };
}

async function cleanup() {
  const teamIds = [...state.teamIds];
  if (teamIds.length) {
    await sql`DELETE FROM group_comments WHERE group_key = ANY(${teamIds})`;
    await sql`DELETE FROM teams WHERE id = ANY(${teamIds})`;
  }
  if (state.userIds.length) {
    await sql`DELETE FROM browse_sessions WHERE id = ANY(${state.userIds})`;
    await sql`DELETE FROM auth.identities WHERE user_id = ANY(${state.userIds})`;
    await sql`DELETE FROM auth.users WHERE id = ANY(${state.userIds})`;
  }
}

async function expectStatus(promise, status, message) {
  const result = await promise;
  assert.equal(result.status, status, `${message}: expected ${status}, got ${result.status}`);
  return result;
}

async function main() {
  const victim = await createConfirmedUser("victim");
  const owner = await createConfirmedUser("owner");
  const logoutOnly = await createConfirmedUser("logout");
  const members = await Promise.all([1, 2, 3, 4, 5, 6].map((index) => createConfirmedUser(`member${index}`)));
  const outsider = await createConfirmedUser("outsider");

  const guest = new Client("guest");
  // The statements are public and come from the Markdown in 2026/, so a caller with no
  // account gets all of them in one response. Only the account-backed routes are closed.
  const publicList = await expectStatus(guest.request("/api/problems", { origin: false }), 200, "problem list is public");
  assert.ok(publicList.body.total >= 618, "problem count includes multiple hackathons");
  assert.equal(publicList.body.items.length, publicList.body.total, "the whole list ships in one response");
  assert.ok(publicList.body.items[0].key, "the list returns generic problem keys");
  assert.match(publicList.headers.get("cache-control") || "", /s-maxage=3600/, "the public list is CDN-cached");
  await expectStatus(guest.request("/api/reviews", { origin: false }), 401, "reviews block unauthenticated callers");
  await expectStatus(guest.request("/api/team", { origin: false }), 401, "team endpoint blocks unauthenticated callers");
  await expectStatus(guest.request("/api/session/refresh", { method: "POST" }), 401, "refresh blocks missing cookie");

  await expectStatus(guest.request("/api/auth", { method: "POST", json: { action: "login", email: "bad", password: PASSWORD } }), 400, "malformed login email rejected");
  await expectStatus(guest.request("/api/auth", { method: "POST", json: { action: "signup", email: "bad", password: PASSWORD } }), 400, "malformed signup email rejected");
  await expectStatus(guest.request("/api/auth", { method: "POST", json: { action: "login", email: victim.email, password: "short" } }), 400, "short login password rejected");
  await expectStatus(guest.request("/api/auth", { method: "POST", json: { action: "signup", email: victim.email, password: "short" } }), 400, "short signup password rejected");
  await expectStatus(guest.request("/api/auth", { method: "POST", json: { action: "login", email: victim.email, password: "WrongPassword123!" } }), 403, "wrong credentials rejected");
  for (let attempt = 2; attempt <= 10; attempt += 1) {
    await expectStatus(guest.request("/api/auth", {
      method: "POST",
      json: { action: "login", email: victim.email, password: "WrongPassword123!" },
    }), 403, `failed login attempt ${attempt} still returns invalid-credentials`);
  }
  await expectStatus(guest.request("/api/auth", {
    method: "POST",
    json: { action: "login", email: victim.email, password: "WrongPassword123!" },
  }), 429, "the per-account throttle blocks the next failed guess");

  const ownerClient = new Client("owner");
  const login = await expectStatus(ownerClient.login(owner.email), 200, "login succeeds for confirmed account");
  assert.ok(login.body.accessToken, "login returns access token");
  assert.ok(ownerClient.cookies.some((cookie) => cookie.name === "sih_refresh" && cookie.path === "/api"), "login sets refresh cookie");

  ownerClient.accessToken = "";
  const refresh = await expectStatus(ownerClient.refresh(), 200, "refresh works from cookie alone");
  assert.equal(refresh.body.email, owner.email, "refresh restores the same account");

  const logoutClient = new Client("logout-only");
  await expectStatus(logoutClient.login(logoutOnly.email), 200, "refresh-only logout account can sign in");
  const stolenRefreshClient = new Client("stolen-refresh");
  stolenRefreshClient.cookies = logoutClient.cookies.map((cookie) => ({ ...cookie }));
  logoutClient.accessToken = "";
  await expectStatus(logoutClient.request("/api/auth", { method: "POST", json: { action: "logout" } }), 200, "logout succeeds with only the refresh cookie");
  await expectStatus(stolenRefreshClient.request("/api/session/refresh", { method: "POST" }), 401, "refresh token is revoked server-side on refresh-only logout");

  const teamName = `Flow Team ${crypto.randomBytes(3).toString("hex")}`;
  const teamPassword = "TeamPass123!";
  const create = await expectStatus(ownerClient.request("/api/team", {
    method: "POST",
    json: { action: "create", teamName, teamPassword, displayName: "Owner Lead" },
  }), 201, "team creation succeeds");
  const teamId = create.body.team.id;
  state.teamIds.add(teamId);
  assert.equal(create.body.team.members, 1, "creator becomes first member");
  assert.equal(create.body.team.roster[0].name, "Owner Lead", "creator name stored in roster");
  assert.equal(create.body.team.roster[0].isLead, true, "creator is lead");
  const ownerSeat = await sql`SELECT seat, is_lead FROM team_members WHERE team_id = ${teamId} AND user_id = ${ownerClient.id}`;
  assert.deepEqual(ownerSeat[0], { seat: 1, is_lead: true }, "creator occupies seat 1 as lead");

  const duplicateNameClient = new Client("duplicate-name");
  await expectStatus(duplicateNameClient.login(members[0].email), 200, "second user login succeeds");
  const duplicateName = await duplicateNameClient.request("/api/team", {
    method: "POST",
    json: { action: "create", teamName: teamName.toLowerCase(), teamPassword, displayName: "Case Clash" },
  });
  assert.equal(duplicateName.status, 409, "team names remain case-insensitively unique");

  const wrongPasswordClient = new Client("wrong-password");
  await expectStatus(wrongPasswordClient.login(members[1].email), 200, "wrong-password test user login succeeds");
  const wrongJoin = await wrongPasswordClient.request("/api/team", {
    method: "POST",
    json: { action: "join", teamName, teamPassword: "WrongTeamPass1!", displayName: "Wrong Guess" },
  });
  assert.equal(wrongJoin.status, 403, "wrong team password rejected");

  const teamClients = [ownerClient];
  for (let index = 0; index < 5; index += 1) {
    const client = new Client(`member-${index + 1}`);
    await expectStatus(client.login(members[index].email), 200, `member ${index + 1} login succeeds`);
    const joined = await expectStatus(client.request("/api/team", {
      method: "POST",
      json: { action: "join", teamName, teamPassword, displayName: `Member ${index + 1}` },
    }), 200, `member ${index + 1} joins team`);
    assert.equal(joined.body.team.members, index + 2, `team count updates after member ${index + 1}`);
    teamClients.push(client);
  }

  const duplicateJoin = await teamClients[1].request("/api/team", {
    method: "POST",
    json: { action: "join", teamName, teamPassword, displayName: "Member 1" },
  });
  assert.equal(duplicateJoin.status, 409, "duplicate join rejected");
  assert.equal(duplicateJoin.body.error, "You are already a member of this team", "duplicate join uses the expected message");

  const fullClient = new Client("member-6");
  await expectStatus(fullClient.login(members[5].email), 200, "sixth joiner login succeeds");
  const fullJoin = await fullClient.request("/api/team", {
    method: "POST",
    json: { action: "join", teamName, teamPassword, displayName: "Member 6" },
  });
  assert.equal(fullJoin.status, 409, "seventh member is refused");
  assert.equal(fullJoin.body.error, "Team is full — maximum 6 members allowed.", "full-team error matches the UI copy");

  const memberCount = await sql`SELECT COUNT(*)::int AS total FROM team_members WHERE team_id = ${teamId}`;
  assert.equal(memberCount[0].total, 6, "database still holds exactly 6 team rows");

  const outsiderClient = new Client("outsider");
  await expectStatus(outsiderClient.login(outsider.email), 200, "outsider login succeeds");
  const sampleProblem = publicList.body.items.find((item) => item.key === "smart-india-hackathon:2026:SIH26011") || publicList.body.items[0];
  const sampleProblemTwo = publicList.body.items.find((item) => item.key === "smart-india-hackathon:2026:SIH26012") || publicList.body.items[1];
  await expectStatus(outsiderClient.request(`/api/comments?problem=${encodeURIComponent(sampleProblem.key)}`, { origin: false }), 403, "non-member cannot read comments");
  await expectStatus(ownerClient.request(`/api/comments?problem=${encodeURIComponent(sampleProblem.key)}`, {
    method: "POST",
    json: { body: "We should build the data ingestion first." },
  }), 201, "team member can post a comment");
  const comments = await expectStatus(teamClients[1].request(`/api/comments?problem=${encodeURIComponent(sampleProblem.key)}`, { origin: false }), 200, "teammate can read comments");
  assert.equal(comments.body.comments[0].display_name, "Owner Lead", "comment keeps the joined display name");

  const reviewBefore = await expectStatus(ownerClient.request(`/api/reviews?problem=${encodeURIComponent(sampleProblem.key)}`, { origin: false }), 200, "review state loads");
  assert.equal(reviewBefore.body.review.decision, "", "new review starts empty");
  const reviewSaved = await expectStatus(ownerClient.request(`/api/reviews?problem=${encodeURIComponent(sampleProblem.key)}`, {
    method: "POST",
    json: { reading: "read", decision: "accept", privateNote: "Best fit for our team", vote: "yes" },
  }), 200, "review state saves");
  assert.equal(reviewSaved.body.review.reading, "read", "reading state persists");
  assert.equal(reviewSaved.body.review.decision, "accept", "decision state persists");
  assert.equal(reviewSaved.body.review.privateNote, "Best fit for our team", "private note persists");
  assert.equal(reviewSaved.body.vote, "yes", "team vote persists for the current user");
  const voteSaved = await expectStatus(teamClients[1].request(`/api/reviews?problem=${encodeURIComponent(sampleProblem.key)}`, {
    method: "POST",
    json: { vote: "maybe" },
  }), 200, "second teammate vote saves");
  assert.equal(voteSaved.body.votes.yes, 1, "team vote summary counts yes votes");
  assert.equal(voteSaved.body.votes.maybe, 1, "team vote summary counts maybe votes");
  const bulkReviews = await expectStatus(ownerClient.request(`/api/reviews?ids=${encodeURIComponent(sampleProblem.key)},${encodeURIComponent(sampleProblemTwo.key)}`, { origin: false }), 200, "bulk review lookup loads");
  assert.equal(bulkReviews.body.reviews[sampleProblem.key].decision, "accept", "bulk review lookup returns saved review state");

  await expectStatus(teamClients[2].request("/api/team", { method: "POST", json: { action: "leave" } }), 200, "member leaves team");
  const reuseClient = new Client("reuse-seat");
  await expectStatus(reuseClient.login(members[5].email), 200, "replacement member login succeeds");
  const reused = await expectStatus(reuseClient.request("/api/team", {
    method: "POST",
    json: { action: "join", teamName, teamPassword, displayName: "Replacement Member" },
  }), 200, "replacement member joins team");
  teamClients.push(reuseClient);
  const reusedSeat = await sql`SELECT seat FROM team_members WHERE team_id = ${teamId} AND user_id = ${reuseClient.id}`;
  assert.equal(reusedSeat[0].seat, 3, "lowest freed seat is reused");
  assert.equal(reused.body.team.members, 6, "team returns to 6 members after reuse");

  await expectStatus(ownerClient.request("/api/team", { method: "POST", json: { action: "leave" } }), 200, "lead can leave team");
  const nextLead = await sql`SELECT leader_name FROM teams WHERE id = ${teamId}`;
  assert.equal(nextLead[0].leader_name, "Member 1", "lowest remaining seat inherits leadership");
  const leadRow = await sql`SELECT is_lead FROM team_members WHERE team_id = ${teamId} AND user_id = ${teamClients[1].id}`;
  assert.equal(leadRow[0].is_lead, true, "inherited leader row is flagged as lead");

  const teamSnapshot = await expectStatus(teamClients[1].request("/api/team", { origin: false }), 200, "team summary still loads after lead handoff");
  assert.equal(teamSnapshot.body.team.leaderName, "Member 1", "team summary reports the new lead");

  const tokenBeforeLogout = outsiderClient.accessToken;
  const logout = await expectStatus(outsiderClient.request("/api/auth", { method: "POST", json: { action: "logout" } }), 200, "logout succeeds");
  assert.equal(logout.body.ok, true, "logout acknowledges success");
  const oldTokenBlocked = await outsiderClient.request("/api/reviews", { origin: false, headers: { Authorization: `Bearer ${tokenBeforeLogout}` } });
  assert.equal(oldTokenBlocked.status, 401, "pre-logout token stops working");
  const refreshAfterLogout = await outsiderClient.request("/api/session/refresh", { method: "POST" });
  assert.equal(refreshAfterLogout.status, 401, "logout clears the refresh cookie");

  const remainingClients = [teamClients[1], wrongPasswordClient, ...teamClients.slice(2), reuseClient].filter((client, index, all) => client && all.indexOf(client) === index);
  for (const client of remainingClients) {
    await expectStatus(client.request("/api/team", { method: "POST", json: { action: "leave" } }), 200, `${client.name} can leave team`);
  }
  const gone = await sql`SELECT 1 FROM teams WHERE id = ${teamId}`;
  assert.equal(gone.length, 0, "empty team is deleted");

  console.log("e2e flow checks passed");
}

try {
  await main();
} finally {
  await cleanup();
  await closeDb();
}
