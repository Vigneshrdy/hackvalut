import fs from "node:fs";
import path from "node:path";

const DATA_DIR = new URL("../data/", import.meta.url);
const HACKATHON_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EDITION_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROBLEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

let cache;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sections(text) {
  const found = {};
  for (const part of text.split(/^## +/m).slice(1)) {
    const breakAt = part.indexOf("\n");
    const heading = (breakAt < 0 ? part : part.slice(0, breakAt)).trim();
    found[heading] = breakAt < 0 ? "" : part.slice(breakAt + 1).trim();
  }
  return found;
}

function markdownField(text, name) {
  return text.match(new RegExp(`^\\*\\*${name}:\\*\\* *(.*?) *$`, "m"))?.[1] || "";
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "[]") return [];
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { data: {}, body: text };
  const block = text.slice(4, end);
  const body = text.slice(end + 5).trimStart();
  const data = {};
  let currentList = null;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    const listItem = line.match(/^\s*-[ ]+(.*)$/);
    if (listItem && currentList) {
      data[currentList].push(parseScalar(listItem[1]));
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_]+):(?:\s+(.*))?$/);
    if (!match) continue;
    const [, key, value = ""] = match;
    if (!value.trim()) {
      data[key] = [];
      currentList = key;
      continue;
    }
    data[key] = parseScalar(value);
    currentList = null;
  }
  return { data, body };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeSummary(problem) {
  return String(problem.description || problem.expected_solution || "").slice(0, 400);
}

function datasetLink(dataset) {
  return String(dataset || "").match(/https?:\/\/\S+/)?.[0] || "";
}

function parseProblemBody(fileName, text) {
  const { data, body } = parseFrontmatter(text);
  const parts = sections(body);
  const titleFromHeading = body.match(/^#{1,6}\s+.*?[—-]\s+(.*)$/m)?.[1]?.trim() || body.match(/^#{1,6}\s+(.*)$/m)?.[1]?.trim() || "";
  const id = String(data.id || fileName.replace(/\.md$/, "")).trim();
  const title = String(data.title || titleFromHeading).trim();
  const inlineBackground = markdownField(body, "Background");
  const inlineDescription = markdownField(body, "Description");
  const inlineExpected = markdownField(body, "Expected Solution") || markdownField(body, "Expected Solutions");
  const inlineDataset = markdownField(body, "Dataset Link") || markdownField(body, "Dataset");
  const legacyBody = body
    .replace(/^#{1,6} .*\n+/, "")
    .replace(/^(\*\*(Organization|Department|Category|Theme):\*\* .*\n)+/m, "")
    .trim();
  const description = String(parts["Problem Statement"] || data.description || [inlineBackground, inlineDescription].filter(Boolean).join("\n\n") || legacyBody).trim();
  const expectedSolution = String(parts["Expected Solution"] || parts["Expected Solutions"] || data.expected_solution || inlineExpected || "").trim();
  const dataset = String(parts.Dataset || data.dataset || inlineDataset || "").trim();
  const tags = Array.isArray(data.tags)
    ? data.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : (typeof data.tags === "string" && data.tags ? [data.tags] : []);

  return {
    id,
    external_id: String(data.external_id || id).trim(),
    title,
    organization: String(data.organization || "").trim(),
    department: String(data.department || "").trim(),
    category: String(data.category || "").trim(),
    theme: String(data.theme || "").trim(),
    description,
    expected_solution: expectedSolution,
    dataset,
    dataset_link: datasetLink(dataset),
    has_dataset: Boolean(dataset),
    source_url: String(data.source_url || "").trim(),
    tags,
    body,
  };
}

function validateHackathon(meta, directoryName) {
  if (!meta || typeof meta !== "object") throw new Error(`Invalid hackathon metadata in ${directoryName}`);
  if (!meta.id || !HACKATHON_ID_RE.test(meta.id)) throw new Error(`Hackathon id must be a lowercase slug: ${directoryName}`);
  if (meta.id !== directoryName) throw new Error(`Hackathon directory and id mismatch: ${directoryName}`);
  if (!meta.name) throw new Error(`Hackathon name is required: ${directoryName}`);
}

function validateEdition(meta, hackathonId, directoryName) {
  if (!meta || typeof meta !== "object") throw new Error(`Invalid edition metadata in ${hackathonId}/${directoryName}`);
  if (!meta.id || !EDITION_ID_RE.test(meta.id)) throw new Error(`Edition id must be a lowercase slug: ${hackathonId}/${directoryName}`);
  if (meta.id !== directoryName) throw new Error(`Edition directory and id mismatch: ${hackathonId}/${directoryName}`);
  if (!meta.name) throw new Error(`Edition name is required: ${hackathonId}/${directoryName}`);
}

function validateProblem(problem, filePath) {
  if (!problem.id || !PROBLEM_ID_RE.test(problem.id)) throw new Error(`Problem id is invalid in ${filePath}`);
  if (!problem.title) throw new Error(`Problem title is required in ${filePath}`);
}

function buildCatalog() {
  if (!fs.existsSync(DATA_DIR)) throw new Error("data/ directory is missing");
  const hackathons = [];
  const hackathonIndex = new Map();
  const editionIndex = new Map();
  const problemIndex = new Map();
  const problems = [];
  const hackathonIds = new Set();

  for (const hackathonDir of fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const root = new URL(`${hackathonDir}/`, DATA_DIR);
    const hackathonMeta = readJson(new URL("hackathon.json", root));
    validateHackathon(hackathonMeta, hackathonDir);
    if (hackathonIds.has(hackathonMeta.id)) throw new Error(`Duplicate hackathon id: ${hackathonMeta.id}`);
    hackathonIds.add(hackathonMeta.id);

    const hackathon = {
      id: hackathonMeta.id,
      name: String(hackathonMeta.name).trim(),
      short_name: String(hackathonMeta.shortName || "").trim(),
      description: String(hackathonMeta.description || "").trim(),
      website: String(hackathonMeta.website || "").trim(),
      logo: hackathonMeta.logo || null,
      license: String(hackathonMeta.license || "").trim(),
      attribution: String(hackathonMeta.attribution || "").trim(),
      source_url: String(hackathonMeta.source_url || "").trim(),
      editions: [],
      stats: { problems: 0 },
    };

    const editions = [];
    const editionIds = new Set();
    for (const editionDir of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      const editionRoot = new URL(`${editionDir}/`, root);
      const metaPath = new URL("edition.json", editionRoot);
      const problemsRoot = new URL("problems/", editionRoot);
      if (!fs.existsSync(metaPath) || !fs.existsSync(problemsRoot)) throw new Error(`Edition must contain edition.json and problems/: ${hackathon.id}/${editionDir}`);
      const editionMeta = readJson(metaPath);
      validateEdition(editionMeta, hackathon.id, editionDir);
      if (editionIds.has(editionMeta.id)) throw new Error(`Duplicate edition id in ${hackathon.id}: ${editionMeta.id}`);
      editionIds.add(editionMeta.id);

      const edition = {
        id: editionMeta.id,
        hackathon_id: hackathon.id,
        name: String(editionMeta.name).trim(),
        year: editionMeta.year ?? null,
        status: String(editionMeta.status || "").trim(),
        description: String(editionMeta.description || "").trim(),
        stats: { problems: 0 },
      };
      const ids = new Set();
      const rows = fs.readdirSync(problemsRoot)
        .filter((name) => name.endsWith(".md"))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
      rows.forEach((fileName, position) => {
        const absolutePath = path.join(problemsRoot.pathname, fileName);
        const parsed = parseProblemBody(fileName, fs.readFileSync(new URL(fileName, problemsRoot), "utf8"));
        validateProblem(parsed, `${hackathon.id}/${edition.id}/problems/${fileName}`);
        if (ids.has(parsed.id)) throw new Error(`Duplicate problem id in ${hackathon.id}/${edition.id}: ${parsed.id}`);
        ids.add(parsed.id);
        const key = `${hackathon.id}:${edition.id}:${parsed.id}`;
        if (problemIndex.has(key)) throw new Error(`Duplicate problem key: ${key}`);
        const problem = {
          ...parsed,
          key,
          slug: slugify(parsed.id) || slugify(parsed.title) || parsed.id.toLowerCase(),
          sno: position + 1,
          summary: safeSummary(parsed),
          hackathon: {
            id: hackathon.id,
            name: hackathon.name,
            short_name: hackathon.short_name,
          },
          edition: {
            id: edition.id,
            name: edition.name,
            year: edition.year,
            status: edition.status,
          },
          file_path: absolutePath,
        };
        problems.push(problem);
        problemIndex.set(key, problem);
      });
      edition.stats.problems = ids.size;
      editions.push(edition);
      editionIndex.set(`${hackathon.id}:${edition.id}`, edition);
      hackathon.stats.problems += edition.stats.problems;
    }

    hackathon.editions = editions;
    hackathons.push(hackathon);
    hackathonIndex.set(hackathon.id, hackathon);
  }

  const filterValues = (rows, pick) => [...new Set(rows.map(pick).flat().filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right), undefined, { sensitivity: "base" }));

  return {
    hackathons,
    problems,
    index: {
      hackathons: hackathonIndex,
      editions: editionIndex,
      problems: problemIndex,
    },
    metadata: {
      stats: {
        hackathons: hackathons.length,
        editions: hackathons.reduce((sum, hackathon) => sum + hackathon.editions.length, 0),
        problems: problems.length,
      },
      filters: {
        hackathons: filterValues(hackathons, (hackathon) => hackathon.id),
        editions: filterValues(problems, (problem) => problem.edition.id),
        organizations: filterValues(problems, (problem) => problem.organization),
        departments: filterValues(problems, (problem) => problem.department),
        categories: filterValues(problems, (problem) => problem.category),
        themes: filterValues(problems, (problem) => problem.theme),
        tags: filterValues(problems, (problem) => problem.tags),
      },
    },
  };
}

export function loadCatalog() {
  cache ||= buildCatalog();
  return cache;
}

export function resetCatalogCache() {
  cache = undefined;
}

export function getHackathons() {
  return loadCatalog().hackathons;
}

export function getHackathon(hackathonId) {
  return loadCatalog().index.hackathons.get(hackathonId) || null;
}

export function getEditions(hackathonId) {
  const hackathon = getHackathon(hackathonId);
  return hackathon ? hackathon.editions : [];
}

export function getEdition(hackathonId, editionId) {
  return loadCatalog().index.editions.get(`${hackathonId}:${editionId}`) || null;
}

export function getProblems(options = {}) {
  const {
    hackathon = "",
    edition = "",
    organization = "",
    department = "",
    category = "",
    theme = "",
    tag = "",
    hasDataset = "",
    q = "",
  } = options;
  const terms = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return loadCatalog().problems.filter((problem) => {
    if (hackathon && problem.hackathon.id !== hackathon) return false;
    if (edition && problem.edition.id !== edition) return false;
    if (organization && problem.organization !== organization) return false;
    if (department && problem.department !== department) return false;
    if (category && problem.category !== category) return false;
    if (theme && problem.theme !== theme) return false;
    if (tag && !problem.tags.includes(tag)) return false;
    if (hasDataset === "true" && !problem.has_dataset) return false;
    if (hasDataset === "false" && problem.has_dataset) return false;
    if (!terms.length) return true;
    const blob = [
      problem.key,
      problem.id,
      problem.external_id,
      problem.title,
      problem.hackathon.name,
      problem.hackathon.short_name,
      problem.edition.id,
      problem.edition.name,
      problem.organization,
      problem.department,
      problem.category,
      problem.theme,
      problem.description,
      problem.expected_solution,
      problem.dataset,
      problem.tags.join(" "),
    ].join(" ").toLowerCase();
    return terms.every((term) => blob.includes(term));
  });
}

export function getProblem(hackathonId, editionId, problemId) {
  return loadCatalog().index.problems.get(`${hackathonId}:${editionId}:${problemId}`) || null;
}

export function getProblemByKey(problemKey) {
  return loadCatalog().index.problems.get(problemKey) || null;
}

export function getMetadata() {
  return loadCatalog().metadata;
}

export function hasProblemKey(problemKey) {
  return loadCatalog().index.problems.has(problemKey);
}
