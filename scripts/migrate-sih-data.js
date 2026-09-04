import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targetRoot = path.join(root, "data", "smart-india-hackathon");
const years = ["2024", "2025", "2026"];

function ensureSafeChild(base, child) {
  const resolved = path.resolve(base, child);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new Error(`Unsafe path: ${child}`);
  }
  return resolved;
}

function parseLegacy(text, fileName) {
  const title = text.match(/^#{1,6}\s+.*?[—-]\s+(.*)$/m)?.[1]?.trim() || text.match(/^#{1,6}\s+(.*)$/m)?.[1]?.trim() || "";
  const field = (name) => text.match(new RegExp(`^\\*\\*${name}:\\*\\* *(.*?) *$`, "m"))?.[1] || "";
  const body = text
    .replace(/^#{1,6} .*\n\n?/, "")
    .replace(/^(\*\*Organization:\*\* .*\n)?(\*\*Department:\*\* .*\n)?(\*\*Category:\*\* .*\n)?(\*\*Theme:\*\* .*\n?)?/, "")
    .trimStart();
  return {
    id: fileName.replace(/\.md$/, ""),
    title,
    organization: field("Organization"),
    department: field("Department"),
    category: field("Category"),
    theme: field("Theme"),
    body: body.trimEnd(),
  };
}

function quote(value) {
  const text = String(value || "");
  return /[:#\[\]{}\-]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
}

function renderProblem(problem, year) {
  const lines = [
    "---",
    `id: ${quote(problem.id)}`,
    `external_id: ${quote(problem.id)}`,
    `title: ${quote(problem.title)}`,
    `organization: ${quote(problem.organization)}`,
    `department: ${quote(problem.department)}`,
    `category: ${quote(problem.category)}`,
    `theme: ${quote(problem.theme)}`,
    `source_url: ${quote(year === "2026" ? "https://www.sih.gov.in/sih2026PS" : "https://www.sih.gov.in/")}`,
    "tags: []",
    "---",
    "",
    problem.body.trim(),
    "",
  ];
  return lines.join("\n");
}

function writeJson(filePath, value) {
  if (fs.existsSync(filePath)) throw new Error(`Refusing to overwrite ${path.relative(root, filePath)}`);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  if (fs.existsSync(targetRoot)) throw new Error("Refusing to overwrite existing data/smart-india-hackathon");
  fs.mkdirSync(targetRoot, { recursive: true });
  writeJson(path.join(targetRoot, "hackathon.json"), {
    id: "smart-india-hackathon",
    name: "Smart India Hackathon",
    shortName: "SIH",
    description: "Archived Smart India Hackathon problem statements.",
    website: "https://www.sih.gov.in/",
    logo: null,
    license: "See ATTRIBUTION.md for source-specific licensing.",
    attribution: "Problem statement text remains attributed to the original publishers and Smart India Hackathon / AICTE.",
    source_url: "https://www.sih.gov.in/",
  });

  const summary = [];
  for (const year of years) {
    const sourceDir = path.join(root, year);
    const editionRoot = ensureSafeChild(targetRoot, year);
    const problemsRoot = ensureSafeChild(editionRoot, "problems");
    fs.mkdirSync(problemsRoot, { recursive: true });
    writeJson(path.join(editionRoot, "edition.json"), {
      id: year,
      name: `Smart India Hackathon ${year}`,
      year: Number(year),
      status: year === "2026" ? "active" : "completed",
      description: "",
    });

    const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".md")).sort();
    for (const fileName of files) {
      const source = fs.readFileSync(path.join(sourceDir, fileName), "utf8");
      const parsed = parseLegacy(source, fileName);
      const destination = path.join(problemsRoot, fileName);
      if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite ${path.relative(root, destination)}`);
      fs.writeFileSync(destination, renderProblem(parsed, year));
    }
    summary.push({ edition: year, count: files.length });
  }

  const total = summary.reduce((sum, row) => sum + row.count, 0);
  console.log(`Migrated Smart India Hackathon data to data/smart-india-hackathon (${total} problems)`);
  for (const row of summary) console.log(`- ${row.edition}: ${row.count}`);
}

main();
