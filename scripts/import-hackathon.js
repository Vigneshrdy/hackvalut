import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("Usage: node scripts/import-hackathon.js --hackathon <id> --edition <id> --source <path>");
    args[key.slice(2)] = value;
  }
  return args;
}

function ensureSafe(base, target) {
  const resolved = path.resolve(base, target);
  const basePath = path.resolve(base);
  if (!resolved.startsWith(basePath + path.sep) && resolved !== basePath) fail(`Unsafe path: ${target}`);
  return resolved;
}

function quote(value) {
  const text = String(value || "");
  return /[:#\[\]{}\-]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
}

function renderProblem(problem) {
  const tags = Array.isArray(problem.tags) ? problem.tags.map((tag) => `  - ${String(tag)}`).join("\n") : "";
  const lines = [
    "---",
    `id: ${quote(problem.id)}`,
    `external_id: ${quote(problem.external_id || problem.id)}`,
    `title: ${quote(problem.title)}`,
    `organization: ${quote(problem.organization || "")}`,
    `department: ${quote(problem.department || "")}`,
    `category: ${quote(problem.category || "")}`,
    `theme: ${quote(problem.theme || "")}`,
    `source_url: ${quote(problem.source_url || "")}`,
    ...(tags ? ["tags:", tags] : ["tags: []"]),
    "---",
    "",
    problem.body || "## Problem Statement\n\n",
  ];
  return `${lines.join("\n").replace(/\n\n\n+/g, "\n\n")}\n`;
}

function main() {
  const { hackathon, edition, source } = readArgs(process.argv);
  if (!hackathon || !edition || !source) fail("Missing required arguments: --hackathon, --edition, --source");
  const sourcePath = path.resolve(root, source);
  if (!fs.existsSync(sourcePath)) fail(`Source not found: ${source}`);
  const incoming = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const items = Array.isArray(incoming) ? incoming : incoming.items;
  if (!Array.isArray(items) || !items.length) fail("Source must contain an array of problems or an items array");
  const problemsRoot = ensureSafe(path.join(root, "data", hackathon, edition), "problems");
  fs.mkdirSync(problemsRoot, { recursive: true });
  const seen = new Set();
  for (const item of items) {
    const id = String(item.id || item.external_id || "").trim();
    const title = String(item.title || "").trim();
    if (!id || !title) fail("Each imported problem requires id and title");
    if (seen.has(id)) fail(`Duplicate problem id in source: ${id}`);
    seen.add(id);
    const filePath = ensureSafe(problemsRoot, `${id}.md`);
    if (fs.existsSync(filePath)) fail(`Refusing to overwrite existing problem: data/${hackathon}/${edition}/problems/${id}.md`);
    fs.writeFileSync(filePath, renderProblem({ ...item, id, title }));
  }
  console.log(`Imported ${items.length} problems into data/${hackathon}/${edition}/problems/`);
}

main();
