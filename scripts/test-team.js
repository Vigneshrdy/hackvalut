// node scripts/test-team.js — team password/name rules plus the DB-level cap wiring.
import assert from "node:assert/strict";
import fs from "node:fs";
import { hashPassword, readName, verifyPassword } from "../api/team.js";

const stored = hashPassword("hunter2222");
assert.ok(verifyPassword("hunter2222", stored), "correct password must verify");
assert.ok(!verifyPassword("hunter2223", stored), "wrong password must fail");
assert.ok(!verifyPassword("hunter2222", "garbage"), "malformed hash must fail, not throw");
assert.notEqual(hashPassword("hunter2222"), stored, "salt must differ per hash");

assert.equal(readName("  Team   Alpha ", 3, 40), "Team Alpha", "trims and collapses whitespace");
assert.equal(readName("ab", 3, 40), "", "too short rejected");
assert.equal(readName("x".repeat(41), 3, 40), "", "too long rejected");
assert.equal(readName("<script>", 3, 40), "", "punctuation outside allowlist rejected");
assert.equal(readName("Vignesh R.", 2, 40), "Vignesh R.", "dots allowed");

// The 6-member cap has to live in the schema, not only in the handler, or a direct
// database write could seat a 7th member.
const schema = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
assert.match(schema, /seat INTEGER NOT NULL CHECK \(seat BETWEEN 1 AND 6\)/, "seat range enforced by CHECK");
assert.match(schema, /UNIQUE \(team_id, seat\)/, "one member per seat");
assert.match(schema, /PRIMARY KEY \(team_id, user_id\)/, "same user cannot join a team twice");
assert.match(schema, /team_members_one_lead_idx ON team_members \(team_id\) WHERE is_lead/, "exactly one lead per team");
assert.match(schema, /team_members_single_team_idx ON team_members \(user_id\)/, "a user belongs to one team");
assert.match(schema, /problem_key TEXT NOT NULL/, "reviews and comments store generic problem keys");

// The handler must map the constraint failures back to the specified messages.
const handler = fs.readFileSync(new URL("../api/team.js", import.meta.url), "utf8");
assert.match(handler, /"23514"\) return "full"/, "check violation reported as a full team");
assert.match(handler, /team_members_single_team_idx"\) return "other-team"/, "single-team violation distinguished");
assert.match(handler, /Team is full — maximum \$\{TEAM_MAX_MEMBERS\} members allowed\./, "exact full-team message");
assert.match(handler, /You are already a member of this team/, "duplicate-join message");

// Seats must be reused, not incremented past the cap: MAX(seat) + 1 permanently
// shrinks a team every time somebody leaves.
assert.doesNotMatch(handler, /MAX\(seat\), 0\) \+ 1/, "must not allocate seats with MAX(seat) + 1");
assert.match(handler, /generate_series\(1, \$\{TEAM_MAX_MEMBERS\}\)/, "seats come from the free 1..6 range");
assert.match(handler, /ORDER BY free\.seat LIMIT 1/, "lowest free seat is taken");

// A team must never be left without its single lead.
assert.match(handler, /UPDATE team_members SET is_lead = TRUE/, "a departing lead hands off leadership");
assert.match(handler, /if \(!remaining\.length\) await sql`DELETE FROM teams/, "an emptied team is removed");

// The full problem statement view must not be clipped by CSS.
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const detailRules = css.split("\n").filter((line) => /^\.detail-(view|body|bar|section|prose|grid)/.test(line.trim()));
assert.ok(detailRules.length > 0, "detail view rules exist");
for (const rule of detailRules) {
  assert.ok(!/line-clamp|overflow:\s*hidden|max-height/.test(rule), `detail view must not clip: ${rule.trim()}`);
}
assert.match(css, /\.detail-prose \{[^}]*white-space: pre-wrap/, "line breaks preserved in prose blocks");

// An author `display:` rule outranks the UA stylesheet's [hidden] rule, so without
// this global guard every element given a display value ignores its own hidden
// attribute -- which left the team bar and the filters live behind the login gate.
assert.match(css, /^\[hidden\] \{ display: none !important; \}$/m, "global [hidden] guard present");

console.log("team + full-view checks passed");
