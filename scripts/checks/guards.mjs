import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCookies, validOrigin } from "../../lib/http.js";

assert.equal(parseCookies({ headers: { cookie: "a=1; b=2" } }).b, "2");
assert.equal(parseCookies({ headers: { cookie: "sih_refresh=old; sih_refresh=new" } }).sih_refresh, "new", "last duplicate wins");
assert.deepEqual(parseCookies({ headers: { cookie: "novalue; =x; a=1" } }), { a: "1" }, "malformed pairs skipped");
assert.equal(parseCookies({ headers: { cookie: "a=%E0%A4%A" } }).a, "%E0%A4%A", "bad percent-encoding does not throw");
assert.deepEqual(parseCookies({ headers: {} }), {});

const withOrigin = (o) => ({ headers: o === undefined ? {} : { origin: o } });
process.env.APP_ORIGIN = "https://hackvault.example";
assert.equal(validOrigin(withOrigin("https://hackvault.example")), true, "configured origin allowed");
assert.equal(validOrigin(withOrigin("https://evil.example")), false, "foreign origin rejected");
assert.equal(validOrigin(withOrigin(undefined)), false, "missing Origin rejected when configured");
process.env.APP_ORIGIN = "";
assert.equal(validOrigin(withOrigin(undefined)), true, "unconfigured deployment still runs");

const session = fs.readFileSync(new URL("../../lib/session.js", import.meta.url), "utf8");
for (const fn of ["setRefreshCookie", "clearRefreshCookie"]) {
  const body = session.slice(session.indexOf(`function ${fn}`));
  assert.match(body.slice(0, 400), /LEGACY_COOKIE_PATH/, `${fn} clears the legacy cookie path`);
}

const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
assert.doesNotMatch(html, /<script(?![^>]*\b(?:src=|type="application\/ld\+json"))/, "no inline executable scripts");
assert.match(html, /<script src="\/theme-init\.js"><\/script>/, "theme restored from an external script before paint");
for (const anchor of ['<section id="ssr-content" hidden></section>', 'id="search"', 'id="filter-button"', 'id="join-group-button"', 'id="problem-list"', 'id="detail-body"']) {
  assert.ok(html.includes(anchor), `index.html keeps anchor ${anchor}`);
}

const app = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");
assert.match(app, /fetch\("\/api\/problems"\)/, "catalog loads from the public bulk endpoint");
assert.doesNotMatch(app, /api\("\/api\/problems/, "public catalog fetch does not require auth");
assert.match(app, /hackvault:compare:v1/, "generic compare storage key is used");
assert.match(app, /hackvault:starred:v1/, "generic starred storage key is used");
assert.doesNotMatch(app, /\^SIH\\d\{5\}\$/, "frontend no longer validates SIH-only identifiers");

const vercel = JSON.parse(fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
assert.equal(vercel.functions["api/statement.js"].includeFiles, "{index.html,data/**}", "SSR function ships the shell and data catalog");
for (const fn of ["api/problems/index.js", "api/problems/[hackathon]/[edition]/[problem].js", "api/hackathons/index.js", "api/hackathons/[hackathonId]/editions.js", "api/sitemap.js"]) {
  assert.equal(vercel.functions[fn].includeFiles, "data/**", `${fn} ships with the catalog`);
}
assert.ok(vercel.rewrites.some((rule) => rule.source === "/hackathons/:hackathonId/:editionId/problems/:problemId"), "problem detail route rewrites to SSR renderer");
assert.ok(vercel.rewrites.some((rule) => rule.source === "/problem-statements/:id"), "legacy SIH routes are preserved as aliases");

const publicApis = [
  fs.readFileSync(new URL("../../api/problems/index.js", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../../api/hackathons/index.js", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../../api/hackathons/[hackathonId]/editions.js", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../../api/sitemap.js", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../../api/statement.js", import.meta.url), "utf8"),
];
for (const source of publicApis) {
  assert.match(source, /lib\/catalog\.js/, "public catalog endpoints read from lib/catalog.js");
  assert.doesNotMatch(source, /lib\/db\.js/, "public catalog endpoints do not read the database");
}

const reviewApi = fs.readFileSync(new URL("../../api/reviews.js", import.meta.url), "utf8");
const commentApi = fs.readFileSync(new URL("../../api/comments/index.js", import.meta.url), "utf8");
assert.match(reviewApi, /problem_key/, "reviews persist generic problem keys");
assert.match(commentApi, /problem_key/, "comments persist generic problem keys");

console.log("guard checks passed");
