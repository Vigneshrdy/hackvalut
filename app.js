import { collectionPath, collections, facets, editionTitle } from "/catalog-urls.js";
const STORAGE = {
  compare: "hackvault:compare:v1",
  starred: "hackvault:starred:v1",
  boardCollapsed: "hackvault:board-collapsed:v1",
  session: "hackvault:session:v1",
  theme: "hackvault:theme",
};

const state = {
  problems: [],
  visibleProblems: [],
  matchedProblems: [],
  allHackathons: [],
  page: 1,
  hasMore: false,
  accessToken: "",
  email: "",
  team: null,
  currentProblem: null,
  currentHackathon: null,
  currentEdition: null,
  route: { name: "home", hackathonId: "", editionId: "", problemId: "" },
  filters: {
    search: "",
    hackathon: "",
    edition: "",
    organization: "",
    department: "",
    category: "",
    theme: "",
    tag: "",
    quick: "",
    individualReview: "",
    teamVote: "",
  },
  reviewCache: {},
  compare: new Set(JSON.parse(localStorage.getItem(STORAGE.compare) || "[]")),
  boardCollapsed: JSON.parse(localStorage.getItem(STORAGE.boardCollapsed) || "{}"),
  starred: new Set(JSON.parse(localStorage.getItem(STORAGE.starred) || "[]")),
  browseScope: "all",
};

const READING_STATES = { "to-read": "To read", read: "Read" };
const DECISION_STATES = { keep: "Keep", accept: "Accept", reject: "Reject" };
const VOTE_STATES = { yes: "Yes", maybe: "Maybe", no: "No" };
const DEFAULT_TITLE = "HackVault";
const HOME_TITLE = "Hackathon Problem Statements — Search & Shortlist | HackVault";
const $ = (selector) => document.querySelector(selector);

let datasetRequest;
let refreshRequest;
let toastTimer;
let commentsObserver;
let searchTimer;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function toast(message, kind = "ok") {
  const node = $("#toast");
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

function persistSet(key, value) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

function setDocumentTitle(title = "") {
  document.title = title ? `${title} | ${DEFAULT_TITLE}` : HOME_TITLE;
  const problem = state.currentProblem;
  const canonicalPath = state.route.name === "detail" && problem ? problemHref(problem) : location.pathname;
  const url = new URL(canonicalPath, location.origin).href;
  const description = problem && state.route.name === "detail"
    ? `${problem.id} · ${problem.organization || problem.hackathon.name}. ${problem.summary}`.slice(0, 165)
    : `${title || "Search hackathon problem statements"}. Browse archived briefs by PS number, theme and organization. Compare and shortlist ideas.`;
  $('link[rel="canonical"]').href = url;
  for (const key of ["description", "og:description", "twitter:description"]) document.querySelector(`meta[name="${key}"],meta[property="${key}"]`)?.setAttribute("content", description);
  for (const key of ["og:title", "twitter:title"]) document.querySelector(`meta[name="${key}"],meta[property="${key}"]`)?.setAttribute("content", document.title);
  $('meta[property="og:url"]').content = url;
  const filtered = Boolean(state.filters.search || state.filters.quick || state.filters.individualReview || state.filters.teamVote);
  $('meta[name="robots"]').content = filtered ? "noindex, follow" : "index, follow";
  const graph = [{ "@type": state.route.name === "detail" ? "WebPage" : "CollectionPage", name: title || "Hackathon problem statements", url, description }];
  if (canonicalPath === "/") graph.push({"@type":"WebSite", name:"HackVault",url});
  if (problem && state.route.name === "detail") graph[0].about = {"@type":"CreativeWork",name:problem.title,identifier:problem.external_id || problem.id};
  $('script[type="application/ld+json"]').textContent = JSON.stringify({"@context":"https://schema.org","@graph":graph});
}

function setVisible(viewId) {
  document.documentElement.classList.remove("js-loading");
  $("#ssr-content").hidden = true;
  $("#spa-root").hidden = false;
  ["#home-view", "#hackathon-view", "#list-view", "#detail-view"].forEach((selector) => { $(selector).hidden = selector !== viewId; });
}

function activeFilterEntries() {
  const scope = ["edition", "detail"].includes(state.route.name) ? ["hackathon", "edition", ...(state.route.kind ? [facets[state.route.kind]] : [])] : [];
  return Object.entries(state.filters)
    .filter(([key, value]) => value && !scope.includes(key))
    .map(([key, value]) => [key, `${key[0].toUpperCase()}${key.slice(1)}: ${value}`]);
}

function emptyReview() {
  return { reading: "", decision: "", privateNote: "", vote: "", votes: { yes: 0, maybe: 0, no: 0, total: 0 } };
}

function normalizeReviewPayload(payload = {}) {
  return {
    ...emptyReview(),
    ...(payload.review || payload),
    vote: payload.vote || payload.review?.vote || "",
    votes: { ...emptyReview().votes, ...(payload.votes || payload.review?.votes || {}) },
  };
}

function reviewState(key) {
  return state.reviewCache[key] || emptyReview();
}

function currentPath() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/problem-statements") return "/hackathons/smart-india-hackathon/2026";
  if (path.startsWith("/problem-statements/")) return `/hackathons/smart-india-hackathon/2026/problems/${encodeURIComponent(path.slice("/problem-statements/".length))}`;
  return path;
}

function parseRoute() {
  const path = currentPath();
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "browse") return {name: "search", hackathonId: "", editionId: "", problemId: ""};
  if (parts.length === 5 && facets[parts[3]]) return {name:"edition",hackathonId:parts[1],editionId:parts[2],problemId:"",kind:parts[3],value:parts[4]};
  if (!parts.length || (parts.length === 1 && parts[0] === "hackathons")) return { name: state.filters.search ? "search" : "home", hackathonId: "", editionId: "", problemId: "" };
  if (parts[0] !== "hackathons") return { name: "home", hackathonId: "", editionId: "", problemId: "" };
  if (parts.length === 2) return { name: "hackathon", hackathonId: parts[1], editionId: "", problemId: "" };
  if (parts.length === 3) return { name: "edition", hackathonId: parts[1], editionId: parts[2], problemId: "" };
  if (parts.length >= 5 && parts[3] === "problems") return { name: "detail", hackathonId: parts[1], editionId: parts[2], problemId: parts[4] };
  return { name: "home", hackathonId: "", editionId: "", problemId: "" };
}

function problemHref(problem) {
  return `/hackathons/${encodeURIComponent(problem.hackathon.id)}/${encodeURIComponent(problem.edition.id)}/problems/${encodeURIComponent(problem.id)}`;
}

function editionHref(hackathonId, editionId) {
  return `/hackathons/${encodeURIComponent(hackathonId)}/${encodeURIComponent(editionId)}`;
}

function hackathonHref(hackathonId) {
  return `/hackathons/${encodeURIComponent(hackathonId)}`;
}

function syncUrl() {
  const path = state.route.name === "home" || state.route.name === "search"
    ? (state.route.name === "search" ? "/browse" : (location.pathname === "/hackathons" ? "/hackathons" : "/"))
    : state.route.name === "hackathon"
      ? hackathonHref(state.route.hackathonId)
      : state.route.name === "edition"
        ? (state.route.kind ? collectionPath(state.route.hackathonId, state.route.editionId, state.route.kind, state.route.value) : editionHref(state.route.hackathonId, state.route.editionId))
        : problemHref(state.currentProblem);
  const params = new URLSearchParams();
  if (state.filters.search) params.set("q", state.filters.search);
  history.replaceState({}, "", `${path}${params.size ? `?${params}` : ""}`);
}

function readUrlState() {
  const params = new URLSearchParams(location.search);
  state.filters.search = params.get("q") || "";
}

function safeUrl(value) {
  try {
    const url = new URL(String(value), location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.session) || "null");
    return saved?.accessToken ? saved : null;
  } catch {
    return null;
  }
}

function saveSession(result) {
  try {
    localStorage.setItem(STORAGE.session, JSON.stringify({
      accessToken: result.accessToken,
      email: result.email || "",
      team: result.team || null,
      expiresAt: Date.now() + (Number(result.expiresIn) || 3600) * 1000,
    }));
  } catch {}
}

function clearSession() {
  localStorage.removeItem(STORAGE.session);
}

async function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = fetch("/api/session/refresh", { method: "POST", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) clearSession();
          const error = new Error(response.status === 401 ? "Session expired" : `Could not restore your session (${response.status})`);
          error.status = response.status;
          throw error;
        }
        const result = await response.json();
        state.accessToken = result.accessToken;
        state.email = result.email || "";
        state.team = result.team || null;
        saveSession(result);
        return result.accessToken;
      })
      .finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

function renderTeamBar() {
  const button = $("#join-group-button");
  $("#logout-button").hidden = !state.accessToken;
  if (!state.accessToken) {
    button.textContent = "Sign in";
    button.title = "Sign in to save notes, reviews, and team votes";
    return;
  }
  if (!state.team) {
    button.textContent = "Create team";
    button.title = "Create or join a team of up to 6 members";
    return;
  }
  button.textContent = `${state.team.name} · ${state.team.members}/${state.team.maxMembers}`;
  button.title = `${state.team.name} — ${state.team.members} of ${state.team.maxMembers} members · Team Lead ${state.team.leaderName}`;
}

function signOutLocal() {
  clearSession();
  state.accessToken = "";
  state.team = null;
  state.reviewCache = {};
  renderTeamBar();
}

async function api(path, options = {}, retry = true) {
  if (!state.accessToken) {
    openAuthDialog("Sign in to use private notes, teams and votes.");
    throw new Error("Sign in to use private notes, teams and votes.");
  }
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${state.accessToken}`);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401 && retry) {
    try {
      await refreshAccessToken();
    } catch (error) {
      if (error.status === 401) {
        signOutLocal();
        openAuthDialog("Your session expired. Log in again.");
      }
      throw error;
    }
    return api(path, options, false);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

const dataset = { rows: [], byKey: new Map(), hackathons: [] };

async function loadDataset() {
  if (dataset.rows.length) return dataset.rows;
  datasetRequest ||= fetch("/api/problems")
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the catalog (${response.status})`);
      return response.json();
    })
    .then((result) => {
      dataset.rows = result.items || [];
      dataset.hackathons = result.hackathons || [];
      dataset.byKey = new Map(dataset.rows.map((row) => [row.key, row]));
      state.allHackathons = [...dataset.hackathons].sort((a,b)=>(b.stats?.problems || 0)-(a.stats?.problems || 0));
      state.problems = dataset.rows;
      return dataset.rows;
    })
    .finally(() => { datasetRequest = null; });
  return datasetRequest;
}

function populateSelect(selector, values, allLabel) {
  const select = $(selector);
  select.length = 1;
  select.options[0].textContent = allLabel;
  values.forEach((value) => select.add(new Option(value, value)));
}

function scopedProblems() {
  if (state.route.name === "edition") return dataset.rows.filter((problem) => problem.hackathon.id === state.route.hackathonId && problem.edition.id === state.route.editionId);
  if (state.route.name === "hackathon") return dataset.rows.filter((problem) => problem.hackathon.id === state.route.hackathonId);
  return dataset.rows;
}

function applyFilterOptions(rows) {
  const unique = (pick) => [...new Set(rows.map(pick).flat().filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
  populateSelect("#hackathon-filter", unique((problem) => problem.hackathon.id), "All hackathons");
  populateSelect("#edition-filter", unique((problem) => problem.edition.id), "All editions");
  populateSelect("#organization-filter", unique((problem) => problem.organization), "All organizations");
  populateSelect("#department-filter", unique((problem) => problem.department), "All departments");
  populateSelect("#category-filter", unique((problem) => problem.category), "All categories");
  populateSelect("#theme-filter", unique((problem) => problem.theme), "All themes");
  populateSelect("#tag-filter", unique((problem) => problem.tags), "All tags");

  [["#hackathon-filter-wrap", $("#hackathon-filter").options.length > 2], ["#edition-filter-wrap", $("#edition-filter").options.length > 2], ["#organization-filter-wrap", $("#organization-filter").options.length > 1], ["#department-filter-wrap", $("#department-filter").options.length > 1], ["#category-filter-wrap", $("#category-filter").options.length > 1], ["#theme-filter-wrap", $("#theme-filter").options.length > 1], ["#tag-filter-wrap", $("#tag-filter").options.length > 1]].forEach(([selector, visible]) => { $(selector).hidden = !visible; });
}

function matchesFilters(problem) {
  const filters = state.filters;
  if (filters.hackathon && problem.hackathon.id !== filters.hackathon) return false;
  if (filters.edition && problem.edition.id !== filters.edition) return false;
  if (filters.organization && problem.organization !== filters.organization) return false;
  if (filters.department && problem.department !== filters.department) return false;
  if (filters.category && problem.category !== filters.category) return false;
  if (filters.theme && problem.theme !== filters.theme) return false;
  if (filters.tag && !problem.tags.includes(filters.tag)) return false;
  if (filters.quick === "dataset" && !problem.has_dataset) return false;
  if (filters.quick === "starred" && !state.starred.has(problem.key)) return false;
  if (filters.quick === "hide-rejected" && reviewState(problem.key).decision === "reject") return false;
  if (filters.individualReview) {
    const review = reviewState(problem.key);
    const matches = filters.individualReview === "to-read" || filters.individualReview === "read"
      ? review.reading === filters.individualReview
      : review.decision === filters.individualReview;
    if (!matches) return false;
  }
  if (filters.teamVote && reviewState(problem.key).vote !== filters.teamVote) return false;
  const terms = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const blob = [
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
    problem.tags.join(" "),
  ].join(" ").toLowerCase();
  return terms.every((term) => blob.includes(term));
}

async function loadReviewsForProblems(keys) {
  if (!state.accessToken) return;
  const missing = keys.filter((key) => !(key in state.reviewCache));
  if (!missing.length) return;
  try {
    const result = await api(`/api/reviews?ids=${missing.map(encodeURIComponent).join(",")}`);
    for (const key of missing) state.reviewCache[key] = normalizeReviewPayload(result.reviews[key] || {});
  } catch {}
}

async function loadReview(key) {
  if (!state.accessToken) return emptyReview();
  try {
    const review = normalizeReviewPayload(await api(`/api/reviews?problem=${encodeURIComponent(key)}`));
    state.reviewCache[key] = review;
    return review;
  } catch {
    return emptyReview();
  }
}

async function saveReview(key, payload) {
  const review = normalizeReviewPayload(await api(`/api/reviews?problem=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  state.reviewCache[key] = review;
  return review;
}

function reviewBadge(tone, label) {
  return `<span class="status-badge ${tone}">${label}</span>`;
}

function reviewBadges(key) {
  const review = reviewState(key);
  return [
    review.reading ? reviewBadge(`reading-${review.reading}`, READING_STATES[review.reading]) : "",
    review.decision ? reviewBadge(`decision-${review.decision}`, DECISION_STATES[review.decision]) : "",
    review.vote ? reviewBadge(`vote-${review.vote}`, `Vote: ${VOTE_STATES[review.vote]}`) : "",
  ].filter(Boolean).join("");
}

function cardTemplate(problem) {
  const starred = state.starred.has(problem.key);
  const inCompare = state.compare.has(problem.key);
  const context = `${problem.hackathon.short_name || problem.hackathon.name} · ${problem.edition.name}`;
  return `<article class="problem-card" data-open="${escapeHtml(problem.key)}">
    <div><span class="ps-id">${escapeHtml(problem.id)}</span>${problem.category ? `<span class="ps-category">${escapeHtml(problem.category)}</span>` : ""}</div>
    <div class="card-main">
      <p class="card-context">${escapeHtml(context)}</p>
      <h2><a href="${problemHref(problem)}">${escapeHtml(problem.title)}</a></h2>
      <p class="card-org">${escapeHtml([problem.organization, problem.theme].filter(Boolean).join(" · "))}</p>
      ${reviewBadges(problem.key) ? `<div class="card-statuses">${reviewBadges(problem.key)}</div>` : ""}
      <p class="card-summary">${escapeHtml(problem.summary)}</p>
      <span class="card-more">Read full statement →</span>
    </div>
    <div class="card-facts">${problem.has_dataset ? '<span class="detail-tag">Dataset</span>' : ""}<button class="text-button" type="button" data-compare="${escapeHtml(problem.key)}">${inCompare ? "Remove compare" : "Compare"}</button></div>
    <button class="icon-button ${starred ? "starred" : ""}" type="button" data-star="${escapeHtml(problem.key)}" aria-pressed="${starred}" aria-label="${starred ? "Remove star from" : "Star"} ${escapeHtml(problem.id)}" title="${starred ? "Remove from shortlist" : "Add to shortlist"}">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg>
    </button>
  </article>`;
}

function renderFilterState() {
  const entries = activeFilterEntries();
  $("#active-filters").innerHTML = entries.map(([key, label]) => `<button class="active-filter" type="button" data-remove-filter="${key}" title="Remove ${key}">${escapeHtml(label)}</button>`).join("");
  $("#filter-badge").textContent = entries.length;
  $("#filter-badge").hidden = entries.length === 0;
  $("#compare-count").textContent = state.compare.size;
  $("#open-compare").hidden = state.compare.size === 0;
  $("#search").value = state.filters.search;
  $("#hackathon-filter").value = state.filters.hackathon;
  $("#edition-filter").value = state.filters.edition;
  $("#organization-filter").value = state.filters.organization;
  $("#department-filter").value = state.filters.department;
  $("#category-filter").value = state.filters.category;
  $("#theme-filter").value = state.filters.theme;
  $("#tag-filter").value = state.filters.tag;
  $("#individual-review").value = state.filters.individualReview;
  $("#team-vote").value = state.filters.teamVote;
  document.querySelectorAll("[data-quick]").forEach((button) => button.classList.toggle("active", button.dataset.quick === state.filters.quick));
}

function reviewSummaryCounts() {
  return state.matchedProblems.reduce((counts, problem) => {
    const review = reviewState(problem.key);
    if (review.reading === "to-read") counts.toRead += 1;
    if (review.reading === "read") counts.read += 1;
    if (review.decision === "keep") counts.keep += 1;
    if (review.decision === "accept") counts.accept += 1;
    if (review.decision === "reject") counts.reject += 1;
    return counts;
  }, { toRead: 0, read: 0, keep: 0, accept: 0, reject: 0 });
}

function renderReviewSummary() {
  const counts = reviewSummaryCounts();
  const cards = [[counts.accept, "Accepted"], [counts.keep, "Keep"], [counts.reject, "Rejected"], [counts.toRead, "To read"], [counts.read, "Read"]].filter(([count]) => count > 0);
  $("#review-summary").innerHTML = cards.map(([count, label]) => `<div class="summary-card"><strong>${count}</strong><span>${label}</span></div>`).join("");
}

function renderBoardSection(title, items) {
  if (!items.length) return "";
  const collapsed = Boolean(state.boardCollapsed[title]);
  return `<section class="board-section"><div class="board-head"><h3>${escapeHtml(title)}</h3><button class="board-toggle" type="button" data-toggle-board="${escapeHtml(title)}">${collapsed ? "Expand" : "Collapse"}</button></div><div class="board-items" ${collapsed ? "hidden" : ""}>${items.map((problem) => `<div class="board-item"><div class="board-copy"><strong>${escapeHtml(problem.id)} · ${escapeHtml(problem.title)}</strong><p>${escapeHtml([problem.hackathon.short_name || problem.hackathon.name, problem.edition.name, problem.organization].filter(Boolean).join(" · "))}</p></div><div class="board-item-actions"><button class="text-button" type="button" data-open="${escapeHtml(problem.key)}">Open</button><button class="text-button" type="button" data-board-decision="keep" data-problem="${escapeHtml(problem.key)}">Keep</button><button class="text-button" type="button" data-board-decision="accept" data-problem="${escapeHtml(problem.key)}">Accept</button><button class="text-button" type="button" data-board-decision="reject" data-problem="${escapeHtml(problem.key)}">Reject</button></div></div>`).join("")}</div></section>`;
}

function renderReviewBoard() {
  const groups = {
    Shortlisted: state.matchedProblems.filter((problem) => state.starred.has(problem.key)),
    Accepted: state.matchedProblems.filter((problem) => reviewState(problem.key).decision === "accept"),
    Keep: state.matchedProblems.filter((problem) => reviewState(problem.key).decision === "keep"),
    Rejected: state.matchedProblems.filter((problem) => reviewState(problem.key).decision === "reject"),
    "To Read": state.matchedProblems.filter((problem) => reviewState(problem.key).reading === "to-read"),
  };
  $("#review-board").innerHTML = Object.entries(groups).map(([title, items]) => renderBoardSection(title, items)).join("");
}

function renderList() {
  const matched = scopedProblems().filter(matchesFilters);
  const pageSize = 12;
  const visible = matched.slice(0, state.page * pageSize);
  state.hasMore = matched.length > visible.length;
  state.matchedProblems = matched;
  state.visibleProblems = visible;
  $("#problem-list").innerHTML = visible.map(cardTemplate).join("");
  $("#problem-list").hidden = visible.length === 0;
  $("#empty-state").hidden = visible.length !== 0;
  $("#empty-state h2").textContent = state.filters.quick === "starred" ? "Your shortlist is empty." : "No problem statements match.";
  $("#empty-state p").textContent = state.filters.quick === "starred" ? "Star a statement to save it on this browser, then compare your choices here." : "Remove a filter or try a broader search term.";
  $("#result-count").textContent = matched.length;
  $("#active-summary").textContent = `· showing ${visible.length}`;
  $("#load-more").hidden = !state.hasMore;
  renderReviewSummary();
  renderReviewBoard();
  renderFilterState();
}

async function loadAndRenderList() {
  const base = scopedProblems();
  applyFilterOptions(dataset.rows);
  renderList();
  await loadReviewsForProblems(state.visibleProblems.map((problem) => problem.key));
  renderList();
}

function breadcrumbLink(label, href) {
  return `<a href="${href}">${escapeHtml(label)}</a>`;
}

function renderBreadcrumbs(items = []) {
  const node = $("#breadcrumbs");
  node.hidden = !items.length;
  const ld = $('script[type="application/ld+json"]');
  const schema = JSON.parse(ld.textContent);
  if(items.length) schema['@graph'].push({'@type':'BreadcrumbList',itemListElement:items.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.label,item:new URL(item.href || location.pathname,location.origin).href}))});
  ld.textContent=JSON.stringify(schema);
  node.innerHTML = items.map((item) => item.href ? breadcrumbLink(item.label, item.href) : `<span>${escapeHtml(item.label)}</span>`).join("<span aria-hidden=\"true\">/</span>");
}

function renderHome() {
  setVisible("#home-view");
  setDocumentTitle("");
  renderBreadcrumbs([]);
  const stats = {
    hackathons: state.allHackathons.length,
    editions: state.allHackathons.reduce((sum, hackathon) => sum + hackathon.editions.length, 0),
    problems: dataset.rows.length,
  };
  $("#hero-stats").innerHTML = [`<div class="summary-card"><strong>${stats.hackathons}</strong><span>Hackathons</span></div>`, `<div class="summary-card"><strong>${stats.editions}</strong><span>Editions</span></div>`, `<div class="summary-card"><strong>${stats.problems}</strong><span>Problems</span></div>`].join("");
  $("#home-editions").innerHTML = state.allHackathons.flatMap(h => [...h.editions].sort((a,b)=>b.id.localeCompare(a.id)).map(e => `<a href="${editionHref(h.id,e.id)}">${escapeHtml(e.name)} →</a>`)).join("");
  $("#home-summary").textContent = `${stats.problems} problem statements across ${stats.editions} editions.`;
  $("#hackathon-grid").innerHTML = state.allHackathons.map((hackathon) => `<article class="catalog-card" tabindex="0" data-href="${hackathonHref(hackathon.id)}"><p class="eyebrow">${escapeHtml(hackathon.short_name || "Hackathon")}</p><h3><a href="${hackathonHref(hackathon.id)}">${escapeHtml(hackathon.name)}</a></h3><p>${escapeHtml(hackathon.description || "Browse editions and problem statements.")}</p><div class="catalog-meta"><span>${hackathon.problemCount || hackathon.stats?.problems || 0} problems</span><span>${hackathon.editions.map((edition) => edition.id).join(", ")}</span></div></article>`).join("");
}

function renderHackathonView() {
  const hackathon = state.allHackathons.find((item) => item.id === state.route.hackathonId);
  if (!hackathon) return renderHome();
  state.currentHackathon = hackathon;
  setVisible("#hackathon-view");
  setDocumentTitle(`${hackathon.name} Problem Statements`);
  renderBreadcrumbs([{ label: "HackVault", href: "/" }, { label: hackathon.name }]);
  $("#hackathon-title").textContent = `${hackathon.name} Problem Statements`;
  $("#hackathon-description").textContent = hackathon.description || "Browse editions and problem statements.";
  $("#hackathon-meta").textContent = `${hackathon.problemCount || hackathon.stats?.problems || 0} problem statements across ${hackathon.editions.length} editions.`;
  $("#edition-grid").innerHTML = hackathon.editions.map((edition) => `<article class="catalog-card" tabindex="0" data-href="${editionHref(hackathon.id, edition.id)}"><p class="eyebrow">Edition</p><h3><a href="${editionHref(hackathon.id, edition.id)}">${escapeHtml(edition.name)}</a></h3><p>${escapeHtml(edition.description || edition.status || "Browse this edition.")}</p><div class="catalog-meta"><span>${edition.problemCount || edition.stats?.problems || 0} problems</span><span>${escapeHtml(String(edition.year || edition.id))}</span></div></article>`).join("");
}

function listHeading() {
  if (state.route.name === "edition") {
    const problem = scopedProblems()[0];
    const hackathon = state.allHackathons.find((item) => item.id === state.route.hackathonId);
    const baseTitle = problem ? editionTitle(hackathon,problem.edition) : `${state.route.hackathonId} ${state.route.editionId} Problem Statements`;
    const title = state.route.value ? `${state.route.value} — ${baseTitle}` : baseTitle;
    return {
      title,
      subtitle: `${scopedProblems().length} problem statements. Search across titles, organizations, departments, categories, themes, tags, and problem text.`,
      crumbs: [{ label: "HackVault", href: "/" }, { label: hackathon?.name || state.route.hackathonId, href: hackathonHref(state.route.hackathonId) }, { label: title }],
    };
  }
  return {
    title: state.filters.quick === "starred" ? "Your shortlist" : state.filters.search ? "Search results" : "Browse problem statements",
    subtitle: state.filters.quick === "starred" ? "Saved on this browser. Compare your choices and open a statement to review it." : "Search the archive by PS number, title, theme or organization.",
    crumbs: [{ label: "HackVault", href: "/" }, { label: "Search" }],
  };
}

async function renderEditionOrSearch() {
  setVisible("#list-view");
  const heading = listHeading();
  setDocumentTitle(heading.title);
  renderBreadcrumbs(heading.crumbs);
  $("#page-title").textContent = heading.title;
  $("#page-subtitle").textContent = heading.subtitle;
  const collectionNav = $("#browse-collections");
  collectionNav.innerHTML = state.route.name === "edition" ? Object.keys(facets).map(kind => `<a href="${collectionPath(state.route.hackathonId,state.route.editionId,kind)}">Browse ${kind}</a>`).join("") : "";
  await loadAndRenderList();
}

function collapseSection(title, inner, open = false) {
  return `<details class="detail-section detail-collapse"${open ? " open" : ""}><summary><h2>${escapeHtml(title)}</h2><span class="collapse-hint" aria-hidden="true"></span></summary><div class="collapse-body">${inner}</div></details>`;
}

function proseSection(title, body, open = false) {
  return body ? collapseSection(title, `<p class="detail-prose">${escapeHtml(body)}</p>`, open) : "";
}

function problemToMarkdown(problem) {
  const frontmatter = [
    "---",
    `id: ${problem.id}`,
    `external_id: ${problem.external_id || problem.id}`,
    `title: ${problem.title}`,
    `organization: ${problem.organization || ""}`,
    `department: ${problem.department || ""}`,
    `category: ${problem.category || ""}`,
    `theme: ${problem.theme || ""}`,
    `source_url: ${problem.source_url || ""}`,
    `tags: ${(problem.tags || []).join(", ")}`,
    "---",
  ];
  const body = [
    problem.description ? `## Problem Statement\n\n${problem.description}` : "",
    problem.expected_solution ? `## Expected Solution\n\n${problem.expected_solution}` : "",
    problem.dataset ? `## Dataset\n\n${problem.dataset}` : "",
  ].filter(Boolean).join("\n\n");
  return `${frontmatter.join("\n")}\n\n${body}`.trim();
}

function detailTemplate(problem) {
  const review = reviewState(problem.key);
  return `<p class="detail-eyebrow">${escapeHtml(problem.hackathon.name)} / ${escapeHtml(problem.edition.name)}</p>
    <h1 id="detail-title">${escapeHtml(problem.title)}</h1>
    <div class="detail-tags"><span class="detail-tag">${escapeHtml(problem.id)}</span>${problem.organization ? `<span class="detail-tag">${escapeHtml(problem.organization)}</span>` : ""}${problem.category ? `<span class="detail-tag">${escapeHtml(problem.category)}</span>` : ""}${problem.theme ? `<span class="detail-tag">${escapeHtml(problem.theme)}</span>` : ""}</div>
    <div class="detail-grid"><div>
      ${proseSection("Problem Statement", problem.description, true)}
      ${proseSection("Expected Solution", problem.expected_solution, true)}
      ${proseSection("Dataset", problem.dataset, true)}
      <section class="detail-section"><h2>Explore related statements</h2><p><a href="${editionHref(problem.hackathon.id,problem.edition.id)}">Browse this edition →</a></p><nav class="related-links">${dataset.rows.filter(p=>p.key!==problem.key && p.hackathon.id===problem.hackathon.id && p.edition.id===problem.edition.id && (problem.theme ? p.theme===problem.theme : p.organization===problem.organization)).slice(0,5).map(p=>`<p><a href="${problemHref(p)}">${escapeHtml(p.id)} · ${escapeHtml(p.title)}</a></p>`).join("")}</nav></section>
    </div><aside>
      <section class="detail-section review-panel"><h2>Your review</h2>
        ${state.accessToken ? "" : '<p class="gate-status">Reading needs no account. Log in to save a review, a private note or a team vote.</p>'}
        <div class="review-group"><span>Reading</span><div class="review-actions">${Object.entries(READING_STATES).map(([value, label]) => `<button class="review-button ${review.reading === value ? "active" : ""}" type="button" data-set-reading="${value}">${label}</button>`).join("")}<button class="review-button clear" type="button" data-clear-reading>Clear</button></div></div>
        <div class="review-group"><span>Decision</span><div class="review-actions">${Object.entries(DECISION_STATES).map(([value, label]) => `<button class="review-button ${review.decision === value ? "active" : ""}" type="button" data-set-decision="${value}">${label}</button>`).join("")}<button class="review-button clear" type="button" data-clear-decision>Clear</button></div></div>
        ${state.team ? `<div class="review-group"><span>Team vote</span><div class="review-actions">${Object.entries(VOTE_STATES).map(([value, label]) => `<button class="review-button ${review.vote === value ? "active" : ""}" type="button" data-set-vote="${value}">${label}</button>`).join("")}<button class="review-button clear" type="button" data-clear-vote>Clear</button></div><div class="card-statuses"><span class="status-badge vote-yes">Yes ${review.votes.yes}</span><span class="status-badge vote-maybe">Maybe ${review.votes.maybe}</span><span class="status-badge vote-no">No ${review.votes.no}</span></div></div>` : ""}
        <form class="private-note-form" id="private-note-form"><label><span class="filter-label">Private note</span><textarea id="private-note-body" maxlength="4000" placeholder="Write your own note for this problem statement…">${escapeHtml(review.privateNote || "")}</textarea></label><div class="private-note-row"><span class="gate-status" id="private-note-status"></span><div class="private-note-actions"><button class="text-button" type="button" id="private-note-clear">Clear note</button><button class="primary-button" type="submit">Save note</button></div></div></form>
        <div class="review-group"><span>Compare</span><div class="review-actions"><button class="review-button ${state.compare.has(problem.key) ? "active" : ""}" type="button" data-compare="${escapeHtml(problem.key)}">${state.compare.has(problem.key) ? "Selected for compare" : "Add to compare"}</button></div></div>
      </section>
      <div class="mini-stat"><span>Hackathon</span><strong><a href="${hackathonHref(problem.hackathon.id)}">${escapeHtml(problem.hackathon.name)}</a></strong></div>
      <div class="mini-stat"><span>Edition</span><strong><a href="${editionHref(problem.hackathon.id,problem.edition.id)}">${escapeHtml(problem.edition.name)}</a></strong></div>
      ${problem.organization ? `<div class="mini-stat"><span>Organization</span><strong><a href="${collectionPath(problem.hackathon.id,problem.edition.id,"organizations",problem.organization)}">${escapeHtml(problem.organization)}</a></strong></div>` : ""}
      ${problem.department ? `<div class="mini-stat"><span>Department</span><strong>${escapeHtml(problem.department)}</strong></div>` : ""}
      ${problem.category ? `<div class="mini-stat"><span>Category</span><strong><a href="${collectionPath(problem.hackathon.id,problem.edition.id,"categories",problem.category)}">${escapeHtml(problem.category)}</a></strong></div>` : ""}
      ${problem.theme ? `<div class="mini-stat"><span>Theme</span><strong><a href="${collectionPath(problem.hackathon.id,problem.edition.id,"themes",problem.theme)}">${escapeHtml(problem.theme)}</a></strong></div>` : ""}
      ${problem.dataset_link ? `<div class="mini-stat"><span>Dataset</span><strong><a href="${escapeHtml(safeUrl(problem.dataset_link))}" rel="noreferrer noopener">Open dataset ↗</a></strong></div>` : ""}
      ${problem.source_url ? `<div class="mini-stat"><span>Source</span><strong><a href="${escapeHtml(safeUrl(problem.source_url))}" rel="noreferrer noopener">Original source ↗</a></strong></div>` : ""}
      <section class="detail-section" id="comments-section"><h2>Team notes</h2>${state.team ? '<div id="comment-list"><p>Loading team notes…</p></div><form class="comment-form" id="comment-form"><textarea id="comment-body" aria-label="Team note" maxlength="2000" required placeholder="Add a team note…"></textarea><div class="comment-row"><span class="gate-status" id="comment-status"></span><button class="primary-button" type="submit">Add team note</button></div></form>' : '<p>Create or join a team to read and leave team notes.</p>'}</section>
    </aside></div>`;
}

function browseSequence() {
  if (state.browseScope === "all") return scopedProblems().filter(matchesFilters);
  if (state.browseScope === "starred") return scopedProblems().filter(matchesFilters).filter((problem) => state.starred.has(problem.key));
  return scopedProblems().filter(matchesFilters).filter((problem) => reviewState(problem.key)[state.browseScope === "to-read" ? "reading" : "decision"] === state.browseScope);
}

function syncDetailNav() {
  if (!state.currentProblem) return;
  const sequence = browseSequence();
  const index = sequence.findIndex((problem) => problem.key === state.currentProblem.key);
  $("#detail-scope").value = state.browseScope;
  $("#detail-prev").disabled = index <= 0;
  $("#detail-next").disabled = index === -1 || index >= sequence.length - 1;
}

function renderCurrentProblem() {
  if (!state.currentProblem) return;
  setVisible("#detail-view");
  setDocumentTitle(`${state.currentProblem.id}: ${state.currentProblem.title}`);
  renderBreadcrumbs([
    { label: "HackVault", href: "/" },
    { label: state.currentProblem.hackathon.name, href: hackathonHref(state.currentProblem.hackathon.id) },
    { label: state.currentProblem.edition.name, href: editionHref(state.currentProblem.hackathon.id, state.currentProblem.edition.id) },
    { label: state.currentProblem.id },
  ]);
  $("#detail-number").textContent = state.currentProblem.id;
  $("#detail-star").dataset.star = state.currentProblem.key;
  $("#detail-star").setAttribute("aria-pressed",state.starred.has(state.currentProblem.key));
  $("#detail-star").classList.toggle("starred", state.starred.has(state.currentProblem.key));
  $("#detail-body").innerHTML = detailTemplate(state.currentProblem);
  $("#private-note-form")?.addEventListener("submit", submitPrivateNote);
  $("#private-note-clear")?.addEventListener("click", () => { $("#private-note-body").value = ""; });
  if (state.team) {
    $("#comment-form").addEventListener("submit", (event) => submitComment(event, state.currentProblem.key));
    watchCommentsLoad(state.currentProblem.key);
  }
  syncDetailNav();
}

function navigate(path, { replace = false } = {}) {
  closeMobileFilters();
  const target = new URL(path,location.origin);
  if(target.pathname === "/browse" && state.route.name !== "search") { state.filters.hackathon=""; state.filters.edition=""; }
  if(state.route.kind && !target.pathname.includes('/problems/')) state.filters[facets[state.route.kind]] = "";
  if(target.searchParams.has('q')) state.filters.search = target.searchParams.get('q');
  if (/\/(themes|organizations|categories)$/.test(new URL(path,location.origin).pathname)) { location.href=path; return; }
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  route().catch(error => toast(error.message,"error"));
}

function openProblemByKey(key) {
  const problem = dataset.byKey.get(key);
  if (!problem) return toast("Problem not found.", "error");
  navigate(problemHref(problem));
}

async function showDetail(problem) {
  state.currentProblem = problem;
  renderCurrentProblem();
  await loadReview(problem.key);
  renderCurrentProblem();
}

function commentTemplate(comment) {
  return `<article class="comment"><span class="comment-meta"><strong>${escapeHtml(comment.display_name)}</strong> · ${new Date(comment.created_at).toLocaleString()}</span><p>${escapeHtml(comment.body)}</p></article>`;
}

async function loadComments(problemKey) {
  try {
    const result = await api(`/api/comments?problem=${encodeURIComponent(problemKey)}`);
    $("#comment-list").innerHTML = result.comments.length ? result.comments.map(commentTemplate).join("") : "<p>No comments yet. Start the discussion for your team.</p>";
  } catch (error) {
    $("#comment-list").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function watchCommentsLoad(problemKey) {
  const section = $("#comments-section");
  if (!section || !state.team) return;
  commentsObserver?.disconnect();
  commentsObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    commentsObserver?.disconnect();
    commentsObserver = null;
    loadComments(problemKey);
  }, { rootMargin: "240px 0px" });
  commentsObserver.observe(section);
}

async function submitComment(event, problemKey) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#comment-status");
  status.textContent = "";
  status.classList.remove("error");
  busy(form, true, "Posting…");
  try {
    await api(`/api/comments?problem=${encodeURIComponent(problemKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: $("#comment-body").value }) });
    $("#comment-body").value = "";
    toast("Comment added");
    await loadComments(problemKey);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    busy(form, false);
  }
}

async function submitPrivateNote(event) {
  event.preventDefault();
  if (!state.currentProblem) return;
  const form = event.currentTarget;
  const status = $("#private-note-status");
  status.textContent = "";
  status.classList.remove("error");
  busy(form, true, "Saving note…");
  try {
    await saveReview(state.currentProblem.key, { ...reviewState(state.currentProblem.key), privateNote: $("#private-note-body").value.trim() });
    renderCurrentProblem();
    renderList();
    toast("Private note saved");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    busy(form, false);
  }
}

function busy(form, isBusy, label) {
  const button = form.querySelector("button[type=submit]");
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = isBusy;
  button.textContent = isBusy ? label : button.dataset.label;
}

function toggleStar(key) {
  state.starred.has(key) ? state.starred.delete(key) : state.starred.add(key);
  persistSet(STORAGE.starred, state.starred);
  if (state.route.name === "detail") renderCurrentProblem();
  renderList();
}

function toggleCompare(key) {
  if (state.compare.has(key)) state.compare.delete(key);
  else {
    if (state.compare.size >= 4) return toast("Compare supports up to 4 problem statements.", "error");
    state.compare.add(key);
  }
  persistSet(STORAGE.compare, state.compare);
  if (state.route.name === "detail") renderCurrentProblem();
  renderFilterState();
  renderList();
}

async function openCompareDialog() {
  const keys = [...state.compare];
  if (keys.length < 2) return toast("Pick at least 2 problem statements to compare.", "error");
  $("#compare-content").innerHTML = "<p>Loading comparison…</p>";
  if (!$("#compare-dialog").open) $("#compare-dialog").showModal();
  const problems = keys.map((key) => dataset.byKey.get(key)).filter(Boolean);
  $("#compare-content").innerHTML = `<div class="compare-grid">${problems.map((problem) => `<article class="compare-card"><span class="detail-tag">${escapeHtml(problem.id)}</span>${problem.category ? `<span class="detail-tag">${escapeHtml(problem.category)}</span>` : ""}${problem.theme ? `<span class="detail-tag">${escapeHtml(problem.theme)}</span>` : ""}<h3>${escapeHtml(problem.title)}</h3><p>${escapeHtml([problem.hackathon.name, problem.edition.name, problem.organization].filter(Boolean).join(" · "))}</p>${reviewBadges(problem.key) ? `<div class="card-statuses">${reviewBadges(problem.key)}</div>` : ""}<p>${escapeHtml(problem.summary || problem.description || "")}</p><div class="board-item-actions"><button class="text-button" type="button" data-open="${escapeHtml(problem.key)}">Open</button><button class="text-button" type="button" data-compare="${escapeHtml(problem.key)}">Remove compare</button></div></article>`).join("")}</div>`;
}

function toggleBoardSection(title) {
  state.boardCollapsed[title] = !state.boardCollapsed[title];
  localStorage.setItem(STORAGE.boardCollapsed, JSON.stringify(state.boardCollapsed));
  renderReviewBoard();
}

async function setDecision(problemKey, decision) {
  await saveReview(problemKey, { ...reviewState(problemKey), decision });
  if (state.currentProblem?.key === problemKey) renderCurrentProblem();
  renderList();
}

function exportBoard() {
  const groups = {
    Shortlisted: state.matchedProblems.filter((problem) => state.starred.has(problem.key)),
    Accepted: state.matchedProblems.filter((problem) => reviewState(problem.key).decision === "accept"),
    Keep: state.matchedProblems.filter((problem) => reviewState(problem.key).decision === "keep"),
    Rejected: state.matchedProblems.filter((problem) => reviewState(problem.key).decision === "reject"),
    "To Read": state.matchedProblems.filter((problem) => reviewState(problem.key).reading === "to-read"),
  };
  const total = Object.values(groups).reduce((sum, items) => sum + items.length, 0);
  if (!total) return toast("Nothing to export yet. Mark some problem statements first.", "error");
  const body = ["# HackVault Review Board", ""]
    .concat(Object.entries(groups).flatMap(([title, items]) => items.length ? [`## ${title}`, ...items.map((problem) => `- ${problem.key} - ${problem.title} (${problem.hackathon.name} / ${problem.edition.name})`), ""] : []))
    .join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hackvault-review-board.md";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function closeMobileFilters() {
  const wasOpen = $("#filters").classList.contains("open");
  $("#filters").classList.remove("open");
  $("#filters").inert = true;
  document.body.classList.remove("filters-open");
  $("#navbar").inert = false;
  $("#results-panel")?.removeAttribute("inert");
  if(wasOpen) $("#filter-button").focus();
  $("#filter-backdrop").hidden = true;
  $("#filter-button").setAttribute("aria-expanded", "false");
}

function clearFilters({ keepScope = false } = {}) {
  const scoped = keepScope ? { hackathon: state.filters.hackathon, edition: state.filters.edition, ...(state.route.kind ? {[facets[state.route.kind]]: state.route.value} : {}) } : { hackathon: "", edition: "" };
  Object.assign(state.filters, { search: "", organization: "", department: "", category: "", theme: "", tag: "", quick: "", individualReview: "", teamVote: "", ...scoped });
  state.page = 1;
  closeMobileFilters();
  if (state.route.name === "home" || state.route.name === "hackathon") return route();
  $("#search").value = "";
  syncUrl();
  renderEditionOrSearch();
}

function openAuthDialog(message = "") {
  const dialog = $("#access-gate");
  $("#gate-status").textContent = message;
  $("#gate-status").classList.toggle("error", Boolean(message));
  $("#auth-submit").disabled = false;
  if (!dialog.open) dialog.showModal();
}

function renderTeamPanel() {
  const inTeam = Boolean(state.team);
  $("#team-panel").hidden = !inTeam;
  $("#team-mode").hidden = inTeam;
  if (!inTeam) return;
  $("#team-create-form").hidden = true;
  $("#team-join-form").hidden = true;
  $("#team-panel-name").textContent = state.team.name;
  $("#team-panel-count").textContent = `${state.team.members} / ${state.team.maxMembers} Members`;
  $("#team-roster").innerHTML = Array.isArray(state.team.roster) ? state.team.roster.map((person) => `<li>${escapeHtml(person.name)}${person.isLead ? '<span class="lead-badge">Team Lead</span>' : ""}</li>`).join("") : "<li>Loading team roster…</li>";
  $("#team-full-note").hidden = !state.team.full;
}

async function loadFullTeam() {
  if (!state.team || Array.isArray(state.team.roster)) return;
  const result = await api("/api/team");
  state.team = result.team;
  renderTeamBar();
  renderTeamPanel();
}

function openTeamDialog(mode) {
  $("#team-status").textContent = "";
  $("#team-status").classList.remove("error");
  renderTeamPanel();
  if (!state.team) setTeamMode(mode);
  if (!$("#group-dialog").open) $("#group-dialog").showModal();
  if (state.team) loadFullTeam().catch((error) => {
    $("#team-status").textContent = error.message;
    $("#team-status").classList.add("error");
  });
}

function setTeamMode(mode) {
  document.querySelectorAll("#team-mode button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("#team-create-form").hidden = mode !== "create";
  $("#team-join-form").hidden = mode === "create";
}

async function submitTeam(event, action) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#team-status");
  const prefix = action === "create" ? "create" : "join";
  status.textContent = "";
  status.classList.remove("error");
  busy(form, true, action === "create" ? "Creating…" : "Joining…");
  try {
    const result = await api("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        teamName: $(`#${prefix}-team-name`).value,
        teamPassword: $(`#${prefix}-team-password`).value,
        displayName: $(action === "create" ? "#create-leader-name" : "#join-member-name").value,
      }),
    });
    state.team = result.team;
    renderTeamBar();
    renderTeamPanel();
    $(`#${prefix}-team-password`).value = "";
    toast(action === "create" ? "Team created successfully" : "You joined the team successfully");
    if (state.currentProblem) renderCurrentProblem();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    busy(form, false);
  }
}

async function leaveTeam() {
  const button = $("#team-leave");
  button.disabled = true;
  try {
    await api("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "leave" }) });
    state.team = null;
    renderTeamBar();
    renderTeamPanel();
    toast("You left the team");
    if (state.currentProblem) renderCurrentProblem();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function setAuthMode(mode) {
  document.querySelectorAll("#auth-mode button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  const submit = $("#auth-submit");
  submit.dataset.mode = mode;
  submit.dataset.label = mode === "signup" ? "Create account" : "Log in";
  submit.textContent = submit.dataset.label;
  $("#auth-password").setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
  $("#gate-status").textContent = mode === "signup" ? "Passwords must be at least 8 characters." : "";
  $("#gate-status").classList.remove("error");
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const action = $("#auth-submit").dataset.mode === "signup" ? "signup" : "login";
  const status = $("#gate-status");
  status.textContent = "";
  status.classList.remove("error");
  busy(form, true, action === "signup" ? "Creating account…" : "Signing in…");
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, email: $("#auth-email").value, password: $("#auth-password").value }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Could not ${action} (${response.status})`);
    if (result.pending) {
      status.textContent = result.message;
      return;
    }
    state.accessToken = result.accessToken;
    state.email = result.email || "";
    state.team = result.team || null;
    saveSession(result);
    state.reviewCache = {};
    $("#auth-password").value = "";
    renderTeamBar();
    await route();
    $("#access-gate").close();
    toast(action === "signup" ? "Account created — welcome" : "Login successful");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    busy(form, false);
  }
}

async function logout() {
  const button = $("#logout-button");
  button.disabled = true;
  const headers = { "Content-Type": "application/json" };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  try {
    await fetch("/api/auth", { method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ action: "logout" }) });
  } finally {
    button.disabled = false;
    signOutLocal();
    navigate("/", { replace: true });
    toast("You are logged out.");
  }
}

function stepStatement(direction) {
  const sequence = browseSequence();
  const index = sequence.findIndex((problem) => problem.key === state.currentProblem?.key);
  const target = index === -1 ? (direction > 0 ? 0 : sequence.length - 1) : index + direction;
  if (target < 0 || target >= sequence.length) return;
  navigate(problemHref(sequence[target]));
}

async function route() {
  await loadDataset();
  state.route = parseRoute();
  if (state.route.name === "home") {
    state.currentProblem = null;
    state.filters.hackathon = "";
    state.filters.edition = "";
    renderHome();
    syncUrl();
    return;
  }
  if (state.route.name === "hackathon") {
    state.currentProblem = null;
    state.filters.hackathon = "";
    state.filters.edition = "";
    renderHackathonView();
    syncUrl();
    return;
  }
  if (state.route.name === "edition" || state.route.name === "search") {
    state.currentProblem = null;
    if (state.route.name === "edition") {
      state.filters.hackathon = state.route.hackathonId;
      state.filters.edition = state.route.editionId;
    }
    if(state.route.kind) state.filters[facets[state.route.kind]] = state.route.value;
    await renderEditionOrSearch();
    syncUrl();
    return;
  }
  const problem = dataset.rows.find((item) => item.hackathon.id === state.route.hackathonId && item.edition.id === state.route.editionId && item.id === state.route.problemId);
  if (!problem) {
    toast("Problem not found.", "error");
    navigate("/", { replace: true });
    return;
  }
  state.filters.hackathon = problem.hackathon.id;
  state.filters.edition = problem.edition.id;
  await loadAndRenderList();
  await showDetail(problem);
  syncUrl();
}

function bindEvents() {
  $("#ask-ai").addEventListener("click", async () => {
    if(!state.currentProblem) return;
    try { await navigator.clipboard.writeText(`Help me evaluate this hackathon problem statement. Identify requirements, data dependencies, risks and a feasible prototype. Distinguish source requirements from your suggestions.\n\n${problemToMarkdown(state.currentProblem)}`); toast("Prompt copied. Paste it into your preferred AI assistant."); } catch { toast("Could not access the clipboard.", "error"); }
  });
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    localStorage.setItem(STORAGE.theme, dark ? "dark" : "light");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#151922" : "#f7f8fa");
  });
  $("#search").addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.page = 1;
      if (state.route.name === "home") navigate(state.filters.search ? "/hackathons" : "/", { replace: true });
      else if (["hackathon","detail"].includes(state.route.name)) navigate("/browse", { replace: true });
      else route();
    }, 250);
  });
  [["#hackathon-filter", "hackathon"], ["#edition-filter", "edition"], ["#organization-filter", "organization"], ["#department-filter", "department"], ["#category-filter", "category"], ["#theme-filter", "theme"], ["#tag-filter", "tag"], ["#individual-review", "individualReview"], ["#team-vote", "teamVote"]].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => {
      if(state.route.kind && key === facets[state.route.kind]) {
        if(event.target.value) return navigate(collectionPath(state.route.hackathonId,state.route.editionId,state.route.kind,event.target.value));
        return navigate(editionHref(state.route.hackathonId,state.route.editionId));
      }
      if(key === "hackathon" && state.route.name === "edition") {
        state.filters.edition = "";
        state.filters.hackathon = event.target.value;
        return navigate("/browse");
      }
      if(key === "edition" && state.route.name === "edition") {
        if(event.target.value) return navigate(editionHref(state.route.hackathonId,event.target.value));
        state.filters.edition = "";
        return navigate("/browse");
      }
      state.filters[key] = event.target.value;
      state.page = 1;
      renderEditionOrSearch();
    });
  });
  $("#quick-picks").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-quick]");
    if (!button) return;
    state.filters.quick = state.filters.quick === button.dataset.quick ? "" : button.dataset.quick;
    state.page = 1;
    renderEditionOrSearch();
  });
  $("#filter-button").addEventListener("click", async () => {
    if (!["edition","search"].includes(state.route.name)) { history.pushState({},"","/browse"); await route(); }
    if ($("#filters").classList.contains("open")) return closeMobileFilters();
    $("#filters").classList.add("open");
    $("#filters").inert = false;
    document.body.classList.add("filters-open");
    $("#filter-close").focus();
    $("#filter-backdrop").hidden = false;
    $("#filter-button").setAttribute("aria-expanded", "true");
  });
  $("#filter-close").addEventListener("click", closeMobileFilters);
  $("#filter-backdrop").addEventListener("click", closeMobileFilters);
  $("#clear-filters").addEventListener("click", () => clearFilters({ keepScope: state.route.name === "edition" }));
  $("#empty-clear").addEventListener("click", () => clearFilters({ keepScope: state.route.name === "edition" }));
  $("#load-more").addEventListener("click", async () => { state.page += 1; await loadAndRenderList(); });
  $("#problem-list").addEventListener("click", (event) => {
    const star = event.target.closest("[data-star]");
    if (star) return toggleStar(star.dataset.star);
    const compare = event.target.closest("[data-compare]");
    if (compare) return toggleCompare(compare.dataset.compare);
    if(event.target.closest("a")) return;
    const card = event.target.closest("[data-open]");
    if (card) openProblemByKey(card.dataset.open);
  });
  $("#problem-list").addEventListener("keydown", (event) => {
    if(event.target.closest("a,button")) return;
    const card = event.target.closest("[data-open]");
    if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openProblemByKey(card.dataset.open); }
  });
  $("#review-board").addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-toggle-board]");
    if (toggle) return toggleBoardSection(toggle.dataset.toggleBoard);
    const open = event.target.closest("[data-open]");
    if (open) return openProblemByKey(open.dataset.open);
    const move = event.target.closest("[data-board-decision]");
    if (!move) return;
    try { await setDecision(move.dataset.problem, move.dataset.boardDecision); } catch (error) { toast(error.message, "error"); }
  });
  $("#active-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-filter]");
    if (!button) return;
    state.filters[button.dataset.removeFilter] = "";
    state.page = 1;
    renderEditionOrSearch();
  });
  $("#detail-back").addEventListener("click", () => {
    if (!state.currentProblem) return navigate("/");
    navigate(editionHref(state.currentProblem.hackathon.id, state.currentProblem.edition.id));
  });
  $("#detail-star").addEventListener("click", (event) => toggleStar(event.currentTarget.dataset.star));
  $("#detail-prev").addEventListener("click", () => stepStatement(-1));
  $("#detail-next").addEventListener("click", () => stepStatement(1));
  $("#detail-scope").addEventListener("change", (event) => { state.browseScope = event.target.value; syncDetailNav(); });
  $("#copy-md").addEventListener("click", async () => {
    if (!state.currentProblem) return;
    try { await navigator.clipboard.writeText(problemToMarkdown(state.currentProblem)); toast("Statement copied as markdown."); } catch { toast("Could not access the clipboard.", "error"); }
  });
  $("#detail-view").addEventListener("click", async (event) => {
    if (!state.currentProblem) return;
    const key = state.currentProblem.key;
    try {
      const reading = event.target.closest("[data-set-reading]");
      if (reading) return await saveReview(key, { ...reviewState(key), reading: reading.dataset.setReading }).then(() => { renderCurrentProblem(); renderList(); });
      const decision = event.target.closest("[data-set-decision]");
      if (decision) return await saveReview(key, { ...reviewState(key), decision: decision.dataset.setDecision }).then(() => { renderCurrentProblem(); renderList(); });
      const vote = event.target.closest("[data-set-vote]");
      if (vote) return await saveReview(key, { ...reviewState(key), vote: vote.dataset.setVote }).then(() => { renderCurrentProblem(); renderList(); });
      if (event.target.closest("[data-clear-reading]")) return await saveReview(key, { ...reviewState(key), reading: "" }).then(() => { renderCurrentProblem(); renderList(); });
      if (event.target.closest("[data-clear-decision]")) return await saveReview(key, { ...reviewState(key), decision: "" }).then(() => { renderCurrentProblem(); renderList(); });
      if (event.target.closest("[data-clear-vote]")) return await saveReview(key, { ...reviewState(key), vote: "" }).then(() => { renderCurrentProblem(); renderList(); });
      const compare = event.target.closest("[data-compare]");
      if (compare) toggleCompare(compare.dataset.compare);
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#nav-shortlist").addEventListener("click", async () => {
    state.filters.quick = "starred";
    state.page = 1;
    if (state.route.name === "edition" || state.route.name === "search") return renderEditionOrSearch();
    navigate("/browse", { replace: true });
  });
  $("#nav-board").addEventListener("click", async () => {
    if (state.route.name !== "edition" && state.route.name !== "search") navigate("/browse", { replace: true });
    setTimeout(() => $("#review-board").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  });
  $("#open-compare").addEventListener("click", openCompareDialog);
  $("#export-board").addEventListener("click", exportBoard);
  $("#compare-dialog-close").addEventListener("click", () => $("#compare-dialog").close());
  $("#compare-content").addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) { $("#compare-dialog").close(); openProblemByKey(open.dataset.open); }
    const compare = event.target.closest("[data-compare]");
    if (compare) { toggleCompare(compare.dataset.compare); openCompareDialog().catch((error) => toast(error.message, "error")); }
  });
  for (const selector of ["#hackathon-grid", "#edition-grid"]) {
    $(selector).addEventListener("click", (event) => {
      if (event.target.closest("a,button")) return;
      const card = event.target.closest("[data-href]");
      if (card) navigate(card.dataset.href);
    });
    $(selector).addEventListener("keydown", (event) => {
      if (event.target.closest("a,button")) return;
      const card = event.target.closest("[data-href]");
      if (card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        navigate(card.dataset.href);
      }
    });
  }
  $("#join-group-button").addEventListener("click", () => {
    if (!state.accessToken) return openAuthDialog("Log in to create or join a team.");
    openTeamDialog(state.team ? "join" : "create");
  });
  $("#group-dialog-close").addEventListener("click", () => $("#group-dialog").close());
  $("#team-mode").addEventListener("click", (event) => { const button = event.target.closest("button"); if (button) setTeamMode(button.dataset.mode); });
  $("#team-create-form").addEventListener("submit", (event) => submitTeam(event, "create"));
  $("#team-join-form").addEventListener("submit", (event) => submitTeam(event, "join"));
  $("#team-leave").addEventListener("click", leaveTeam);
  $("#auth-mode").addEventListener("click", (event) => { const button = event.target.closest("button"); if (button) setAuthMode(button.dataset.mode); });
  $("#auth-form").addEventListener("submit", submitAuth);
  $("#auth-back").addEventListener("click", () => $("#access-gate").close());
  $("#logout-button").addEventListener("click", logout);
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="/"]');
    if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.defaultPrevented) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || url.hash || /\/(themes|organizations|categories)$/.test(url.pathname)) return;
    if(!/^\/(?:hackathons(?:\/|$)|browse(?:$|\?)|$)/.test(url.pathname)) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}`);
  });
  window.addEventListener("popstate", () => { readUrlState(); route(); });
  document.addEventListener("keydown", (event) => {
    if($("#filters").classList.contains("open") && event.key === "Tab") {
      const nodes = [...$("#filters").querySelectorAll("button,select,input")].filter(n=>n.getClientRects().length && !n.disabled);
      const first=nodes[0], last=nodes.at(-1);
      if(event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
      return;
    }
    if(document.querySelector("dialog[open]")) return;
    if (event.key === "Escape" && $("#filters").classList.contains("open")) closeMobileFilters();
    if (event.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { event.preventDefault(); $("#search").focus(); }
    if (state.currentProblem && !event.target.matches("input, textarea, select")) {
      if (event.key === "ArrowLeft") stepStatement(-1);
      if (event.key === "ArrowRight") stepStatement(1);
    }
  });
}

async function boot() {
  readUrlState();
  bindEvents();
  setAuthMode("login");
  $("#navbar").hidden = false;
  const saved = readSession();
  if (saved) {
    state.accessToken = saved.accessToken;
    state.email = saved.email;
    state.team = saved.team;
    renderTeamBar();
    await route();
    if (saved.expiresAt - Date.now() < 5 * 60 * 1000) refreshAccessToken().then(renderTeamBar).catch(() => {});
  } else {
    renderTeamBar();
    await route();
    try {
      await refreshAccessToken();
      renderTeamBar();
      if(state.accessToken) await route();
    } catch {}
  }
  $("#boot-screen").hidden = true;
}

boot().catch((error) => {
  document.documentElement.classList.remove("js-loading");
  $("#boot-screen").hidden = true;
  $("#navbar").hidden = false;
  if($("#ssr-content").hidden) $("#ssr-content").innerHTML = '<div class="network-state"><h1>Could not load the archive</h1><p>Check your connection and reload to try again.</p><a href="/">Reload HackVault</a></div>';
  $("#ssr-content").hidden = false;
  toast("Interactive tools could not load. The archived page is still available. Reload to retry.", "error");
});
