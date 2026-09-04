import fs from "node:fs";
import { getEdition, getHackathon, getProblem, getProblems } from "../lib/catalog.js";
import { methodNotAllowed } from "../lib/http.js";

let shell;

function loadShell() {
  shell ||= fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  return shell;
}

function originFor(request) {
  const configured = (process.env.APP_ORIGIN || "").split(",")[0].trim();
  if (configured) return configured.replace(/\/$/, "");
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers.host || "example.com";
  return `${protocol}://${host}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function clamp(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, clean.lastIndexOf(" ", max) || max)}…`;
}

function renderPage({ title, description, url, body, ld }) {
  const meta = [
    [/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`],
    [/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`],
    [/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeHtml(url)}" />`],
    [/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`],
    [/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`],
    [/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${escapeHtml(url)}" />`],
    [/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)}" />`],
    [/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`],
    [/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`],
    [/<section class="access-gate access-gate-loading" id="boot-screen"/, '<section class="access-gate access-gate-loading" id="boot-screen" hidden'],
    [/<section id="ssr-content" hidden><\/section>/, `<section id="ssr-content">${body}</section>`],
  ];
  let html = loadShell();
  for (const [pattern, replacement] of meta) html = html.replace(pattern, replacement);
  return html;
}

function send(response, status, html) {
  response.status(status);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return response.send(html);
}

function breadcrumb(origin, items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${origin}${item.href}`,
    })),
  };
}

function homeBody(origin) {
  const hackathons = [...getProblems().reduce((map, problem) => {
    const entry = map.get(problem.hackathon.id) || { ...problem.hackathon, editions: new Set(), problems: 0 };
    entry.editions.add(problem.edition.name);
    entry.problems += 1;
    map.set(problem.hackathon.id, entry);
    return map;
  }, new Map()).values()];
  return `<div class="ssr-wrap"><p class="eyebrow">HackVault</p><h1>Browse and shortlist problem statements from hackathons</h1><p>HackVault Framework keeps public hackathon problem statements in Markdown and exposes them through a lightweight browser, search, shortlist and review workflow.</p><div class="ssr-card-grid">${hackathons.map((hackathon) => `<article class="ssr-card"><h2><a href="${origin}/hackathons/${encodeURIComponent(hackathon.id)}">${escapeHtml(hackathon.name)}</a></h2><p>${hackathon.problems} problem statements</p><p>${escapeHtml([...hackathon.editions].join(", "))}</p></article>`).join("")}</div></div>`;
}

function hackathonBody(origin, hackathon) {
  return `<div class="ssr-wrap"><nav class="ssr-breadcrumb"><a href="${origin}/">HackVault</a> / <span>${escapeHtml(hackathon.name)}</span></nav><h1>${escapeHtml(hackathon.name)}</h1><p>${escapeHtml(hackathon.description || "Browse editions and problem statements.")}</p><div class="ssr-card-grid">${hackathon.editions.map((edition) => `<article class="ssr-card"><h2><a href="${origin}/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}">${escapeHtml(edition.name)}</a></h2><p>${edition.stats.problems} problem statements</p><p>${escapeHtml(edition.description || edition.status || "")}</p></article>`).join("")}</div></div>`;
}

function editionBody(origin, hackathon, edition) {
  const problems = getProblems({ hackathon: hackathon.id, edition: edition.id });
  return `<div class="ssr-wrap"><nav class="ssr-breadcrumb"><a href="${origin}/">HackVault</a> / <a href="${origin}/hackathons/${encodeURIComponent(hackathon.id)}">${escapeHtml(hackathon.name)}</a> / <span>${escapeHtml(edition.name)}</span></nav><h1>${escapeHtml(edition.name)}</h1><p>${problems.length} problem statements.</p><ul class="ssr-list">${problems.map((problem) => `<li><a href="${origin}/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}/problems/${encodeURIComponent(problem.id)}">${escapeHtml(problem.id)} — ${escapeHtml(problem.title)}</a></li>`).join("")}</ul></div>`;
}

function problemBody(origin, problem) {
  const detailUrl = `${origin}/hackathons/${encodeURIComponent(problem.hackathon.id)}/${encodeURIComponent(problem.edition.id)}/problems/${encodeURIComponent(problem.id)}`;
  return `<div class="ssr-wrap"><nav class="ssr-breadcrumb"><a href="${origin}/">HackVault</a> / <a href="${origin}/hackathons/${encodeURIComponent(problem.hackathon.id)}">${escapeHtml(problem.hackathon.name)}</a> / <a href="${origin}/hackathons/${encodeURIComponent(problem.hackathon.id)}/${encodeURIComponent(problem.edition.id)}">${escapeHtml(problem.edition.name)}</a> / <span>${escapeHtml(problem.id)}</span></nav><p class="detail-eyebrow">${escapeHtml(problem.organization || problem.hackathon.name)}</p><h1>${escapeHtml(problem.title)}</h1><div class="detail-tags"><span class="detail-tag">${escapeHtml(problem.id)}</span>${problem.category ? `<span class="detail-tag">${escapeHtml(problem.category)}</span>` : ""}${problem.theme ? `<span class="detail-tag">${escapeHtml(problem.theme)}</span>` : ""}</div><div class="detail-grid"><div>${problem.description ? `<section class="detail-section"><h2>Problem Statement</h2><p class="detail-prose">${escapeHtml(problem.description)}</p></section>` : ""}${problem.expected_solution ? `<section class="detail-section"><h2>Expected Solution</h2><p class="detail-prose">${escapeHtml(problem.expected_solution)}</p></section>` : ""}${problem.dataset ? `<section class="detail-section"><h2>Dataset</h2><p class="detail-prose">${escapeHtml(problem.dataset)}</p></section>` : ""}</div><aside><div class="mini-stat"><span>Hackathon</span><strong>${escapeHtml(problem.hackathon.name)}</strong></div><div class="mini-stat"><span>Edition</span><strong>${escapeHtml(problem.edition.name)}</strong></div>${problem.organization ? `<div class="mini-stat"><span>Organization</span><strong>${escapeHtml(problem.organization)}</strong></div>` : ""}${problem.department ? `<div class="mini-stat"><span>Department</span><strong>${escapeHtml(problem.department)}</strong></div>` : ""}${problem.dataset_link ? `<div class="mini-stat"><span>Dataset</span><strong><a href="${escapeHtml(problem.dataset_link)}">Open dataset</a></strong></div>` : ""}${problem.source_url ? `<div class="mini-stat"><span>Source</span><strong><a href="${escapeHtml(problem.source_url)}">Official source</a></strong></div>` : ""}</aside></div><p><a href="${detailUrl}">Canonical URL</a></p></div>`;
}

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const origin = originFor(request);
  const hackathonId = String(request.query.hackathon || "").trim();
  const editionId = String(request.query.edition || "").trim();
  const problemId = String(request.query.problem || request.query.id || request.query.legacyId || "").trim();

  if (request.query.legacyId) {
    const legacy = getProblem("smart-india-hackathon", "2026", problemId);
    if (!legacy) return send(response, 404, renderPage({ title: "Problem not found | HackVault", description: "That problem statement was not found.", url: `${origin}/hackathons`, body: `<div class="ssr-wrap"><h1>Problem not found</h1></div>`, ld: { "@context": "https://schema.org", "@type": "WebPage", name: "Problem not found" } }));
    return send(response, 200, renderPage({
      title: `${legacy.id} - ${clamp(legacy.title, 90)} | HackVault`,
      description: clamp(`${legacy.id}: ${legacy.summary}`, 180),
      url: `${origin}/hackathons/${legacy.hackathon.id}/${legacy.edition.id}/problems/${encodeURIComponent(legacy.id)}`,
      body: problemBody(origin, legacy),
      ld: { "@context": "https://schema.org", "@type": "WebPage", name: legacy.title },
    }));
  }

  if (!hackathonId) {
    return send(response, 200, renderPage({
      title: "HackVault",
      description: "Open-source problem statement explorer for hackathons.",
      url: `${origin}/`,
      body: homeBody(origin),
      ld: { "@context": "https://schema.org", "@type": "WebSite", name: "HackVault", url: `${origin}/` },
    }));
  }

  const hackathon = getHackathon(hackathonId);
  if (!hackathon) return send(response, 404, renderPage({ title: "Hackathon not found | HackVault", description: "That hackathon was not found.", url: `${origin}/hackathons`, body: `<div class="ssr-wrap"><h1>Hackathon not found</h1></div>`, ld: { "@context": "https://schema.org", "@type": "WebPage", name: "Hackathon not found" } }));

  if (!editionId) {
    return send(response, 200, renderPage({
      title: `HackVault | ${hackathon.name}`,
      description: clamp(hackathon.description || `Browse ${hackathon.name} editions and problem statements.`, 180),
      url: `${origin}/hackathons/${encodeURIComponent(hackathon.id)}`,
      body: hackathonBody(origin, hackathon),
      ld: { "@context": "https://schema.org", "@graph": [breadcrumb(origin, [{ name: "HackVault", href: "/" }, { name: hackathon.name, href: `/hackathons/${hackathon.id}` }])] },
    }));
  }

  const edition = getEdition(hackathon.id, editionId);
  if (!edition) return send(response, 404, renderPage({ title: "Edition not found | HackVault", description: "That edition was not found.", url: `${origin}/hackathons/${encodeURIComponent(hackathon.id)}`, body: `<div class="ssr-wrap"><h1>Edition not found</h1></div>`, ld: { "@context": "https://schema.org", "@type": "WebPage", name: "Edition not found" } }));

  if (!problemId) {
    return send(response, 200, renderPage({
      title: `${edition.name} | HackVault`,
      description: clamp(`Browse ${edition.name} problem statements by organization, category, theme, dataset availability, and search terms.`, 180),
      url: `${origin}/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}`,
      body: editionBody(origin, hackathon, edition),
      ld: { "@context": "https://schema.org", "@graph": [breadcrumb(origin, [{ name: "HackVault", href: "/" }, { name: hackathon.name, href: `/hackathons/${hackathon.id}` }, { name: edition.name, href: `/hackathons/${hackathon.id}/${edition.id}` }])] },
    }));
  }

  const problem = getProblem(hackathon.id, edition.id, problemId);
  if (!problem) return send(response, 404, renderPage({ title: "Problem not found | HackVault", description: "That problem statement was not found.", url: `${origin}/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}`, body: `<div class="ssr-wrap"><h1>Problem not found</h1></div>`, ld: { "@context": "https://schema.org", "@type": "WebPage", name: "Problem not found" } }));
  const canonical = `${origin}/hackathons/${encodeURIComponent(hackathon.id)}/${encodeURIComponent(edition.id)}/problems/${encodeURIComponent(problem.id)}`;
  return send(response, 200, renderPage({
    title: `${problem.id} - ${clamp(problem.title, 90)} | HackVault`,
    description: clamp(`${problem.id}: ${problem.summary}`, 180),
    url: canonical,
    body: problemBody(origin, problem),
    ld: {
      "@context": "https://schema.org",
      "@graph": [
        breadcrumb(origin, [
          { name: "HackVault", href: "/" },
          { name: hackathon.name, href: `/hackathons/${hackathon.id}` },
          { name: edition.name, href: `/hackathons/${hackathon.id}/${edition.id}` },
          { name: problem.id, href: `/hackathons/${hackathon.id}/${edition.id}/problems/${problem.id}` },
        ]),
        {
          "@type": "WebPage",
          name: problem.title,
          url: canonical,
          description: clamp(problem.summary, 300),
          about: {
            "@type": "CreativeWork",
            name: problem.title,
            identifier: problem.external_id || problem.id,
            genre: problem.theme || problem.category || "Problem Statement",
          },
        },
      ],
    },
  }));
}
