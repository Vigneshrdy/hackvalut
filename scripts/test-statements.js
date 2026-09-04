import assert from "node:assert/strict";
import { getEdition, getHackathons, getMetadata, getProblem, getProblems, loadCatalog } from "../lib/catalog.js";

const catalog = loadCatalog();
const again = loadCatalog();
const problems = getProblems();
const hackathons = getHackathons();

assert.equal(catalog, again, "catalog is cached at module scope");
assert.equal(hackathons.length, 2, "at least two hackathons are present");
assert.ok(hackathons.some((hackathon) => hackathon.id === "smart-india-hackathon"), "migrated SIH hackathon exists");
assert.ok(hackathons.some((hackathon) => hackathon.id === "open-innovation-demo"), "synthetic demo hackathon exists");

const sih = hackathons.find((hackathon) => hackathon.id === "smart-india-hackathon");
const demo = hackathons.find((hackathon) => hackathon.id === "open-innovation-demo");
assert.equal(sih.stats.problems, 614, "SIH archive count is preserved");
assert.equal(demo.stats.problems, 4, "demo hackathon count is preserved");
assert.equal(getEdition("smart-india-hackathon", "2024").stats.problems, 246, "2024 SIH count preserved");
assert.equal(getEdition("smart-india-hackathon", "2025").stats.problems, 135, "2025 SIH count preserved");
assert.equal(getEdition("smart-india-hackathon", "2026").stats.problems, 233, "2026 SIH count preserved");

const keys = new Set(problems.map((problem) => problem.key));
assert.equal(keys.size, problems.length, "problem keys are globally unique");
assert.equal(getMetadata().stats.problems, problems.length, "metadata totals match catalog totals");

for (const problem of problems) {
  const where = problem.key;
  assert.ok(problem.id, `${where}: has an id`);
  assert.ok(problem.title, `${where}: has a title`);
  assert.ok(problem.hackathon.id, `${where}: has hackathon context`);
  assert.ok(problem.edition.id, `${where}: has edition context`);
  assert.equal(problem.summary.length <= 400, true, `${where}: summary is clipped`);
}

assert.equal(getProblem("open-innovation-demo", "season-1", "WEB-7").key, "open-innovation-demo:season-1:WEB-7", "non-SIH IDs resolve correctly");
assert.equal(getProblem("open-innovation-demo", "season-1", "challenge-alpha").id, "challenge-alpha", "lowercase hyphenated IDs resolve correctly");
assert.ok(getProblems({ q: "translators" }).some((problem) => problem.key === "open-innovation-demo:season-1:challenge-alpha"), "full-text search works across demo hackathon text");
assert.ok(getProblems({ q: "ISRO" }).some((problem) => problem.hackathon.id === "smart-india-hackathon"), "search works across SIH metadata");
assert.ok(getProblems({ hackathon: "smart-india-hackathon", edition: "2026" }).every((problem) => problem.hackathon.id === "smart-india-hackathon" && problem.edition.id === "2026"), "filtering by hackathon and edition works");

const sihDataset = getProblem("smart-india-hackathon", "2026", "SIH26038");
assert.ok(sihDataset.has_dataset, "SIH dataset flag preserved");
assert.match(sihDataset.dataset_link, /^https?:\/\//, "SIH dataset link extracted");
const demoDataset = getProblem("open-innovation-demo", "season-1", "WEB-7");
assert.ok(demoDataset.has_dataset, "demo dataset flag preserved");
assert.match(demoDataset.dataset_link, /^https?:\/\//, "demo dataset link extracted");

console.log(`catalog checks passed (${hackathons.length} hackathons, ${problems.length} problems)`);
