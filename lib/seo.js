import { getHackathons, getProblems, getHackathon, getEdition, getProblem } from './catalog.js';
import { hackathonPath, editionPath, problemPath, collectionPath, collections, facets, editionTitle } from '../catalog-urls.js';
export const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const clamp = (value, n = 165) => { const s = String(value || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n) || n)}…`; };
export function originFor(request) {
  const configured = (process.env.APP_ORIGIN || '').split(',')[0].trim();
  return (configured || `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers.host || 'localhost'}`).replace(/\/$/, '');
}
export function publicPaths() {
  return ['/', '/hackathons', '/browse', ...getHackathons().flatMap(h => [hackathonPath(h.id), ...h.editions.flatMap(e => {
    const rows = getProblems({hackathon:h.id, edition:e.id});
    return [editionPath(h.id,e.id), ...Object.keys(facets).filter(k => rows.some(p => p[facets[k]])).map(k => collectionPath(h.id,e.id,k)), ...collections(rows).map(c => collectionPath(h.id,e.id,c.kind,c.value))];
  })]), ...getProblems().map(problemPath)];
}
const link = (href, text) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
function listing(rows) {
  return `<ul class="ssr-list">${rows.map(p => `<li>${link(problemPath(p), `${p.id} — ${p.title}`)}<p>${escapeHtml([p.organization,p.theme,p.category].filter(Boolean).join(' · '))}</p></li>`).join('')}</ul>`;
}
export function collectionLinks(h,e,rows) {
  return `<nav class="collection-links" aria-label="Browse by theme, organization or category">${Object.keys(facets).filter(k => rows.some(p => p[facets[k]])).map(k => link(collectionPath(h,e,k), k[0].toUpperCase()+k.slice(1))).join('')}</nav>`;
}
export function describePage(request) {
  const origin = originFor(request);
  const pathname = new URL(request.url || '/', origin).pathname.replace(/\/$/,'') || '/';
  const q = request.query || {};
  const h = q.hackathon ? getHackathon(q.hackathon) : null;
  const e = h && q.edition ? getEdition(h.id,q.edition) : null;
  const p = e && q.problem ? getProblem(h.id,e.id,q.problem) : null;
  const all = getProblems();
  const base = e ? editionPath(h.id,e.id) : h ? hackathonPath(h.id) : pathname;
  let path = base, title, description, content, rows = [], type = 'CollectionPage';
  let crumbs = [{name:'HackVault',href:'/'}];
  if (h) crumbs.push({name:h.name,href:hackathonPath(h.id)});
  if (e) crumbs.push({name:e.name,href:base});
  const fail = () => ({status:404,title:'Page not found | HackVault',description:'Find a hackathon problem statement by title or PS number.',path:pathname,body:`<div class="ssr-wrap"><p class="eyebrow">404 · Page not found</p><h1>That page is not in the archive.</h1><p>The link may be incomplete or the statement may have moved. Search by PS number, title, organization, or theme.</p><form action="/browse" class="nav-search" role="search"><label class="search-input-wrap"><input type="search" name="q" aria-label="Search the archive" placeholder="Search by PS number or title" /></label><button class="primary-button">Search</button></form><p>${link('/browse','Browse problem statements')} · ${link('/','Back to HackVault')}</p></div>`,ld:{'@context':'https://schema.org','@type':'WebPage',name:'Page not found'}});
  if (q.notFound || (q.hackathon && !h) || (q.edition && !e) || (q.problem && !p)) return fail();
  if (p) {
    path = problemPath(p); title = `${p.id}: ${p.title}`; description = clamp(`${p.id} · ${p.organization || h.name}. ${p.summary || p.description}`); type='WebPage';
    crumbs.push({name:p.id,href:path});
    const metadata = [['Hackathon',h.name,hackathonPath(h.id)],['Edition',e.name,base],['Organization',p.organization,p.organization && collectionPath(h.id,e.id,'organizations',p.organization)],['Theme',p.theme,p.theme && collectionPath(h.id,e.id,'themes',p.theme)],['Category',p.category,p.category && collectionPath(h.id,e.id,'categories',p.category)],['Department',p.department]];
    const related = all.filter(x=>x.key!==p.key && x.hackathon.id===h.id && x.edition.id===e.id && (p.theme ? x.theme===p.theme : x.organization===p.organization)).slice(0,5);
    const safeLink = (url,label) => /^https?:\/\//i.test(url || '') ? `<p>${link(url,label)}</p>` : '';
    content = `<p class="ps-id">${escapeHtml(p.id)}</p><h1>${escapeHtml(p.title)}</h1><p>${escapeHtml(p.organization || h.name)}</p><div class="detail-grid"><div>${[['Problem statement',p.description],['Expected solution',p.expected_solution],['Dataset / resources',p.dataset]].filter(([,v])=>v).map(([label,value])=>`<section class="detail-section"><h2>${label}</h2><p class="detail-prose">${escapeHtml(value)}</p></section>`).join('')}${safeLink(p.dataset_link,'Open dataset')}${safeLink(p.source_url,'View original source')}<section class="detail-section"><h2>Related problem statements</h2>${listing(related)}</section></div><aside>${metadata.filter(([,v])=>v).map(([label,value,href])=>`<div class="mini-stat"><span>${label}</span><strong>${href ? link(href,value):escapeHtml(value)}</strong></div>`).join('')}</aside></div>`;
  } else if (e) {
    rows = getProblems({hackathon:h.id,edition:e.id});
    title = editionTitle(h,e);
    if (q.kind) {
      if (!facets[q.kind]) return fail();
      path = collectionPath(h.id,e.id,q.kind,q.value);
      crumbs.push({name:q.kind,href:collectionPath(h.id,e.id,q.kind)});
      if (q.value) {
        rows = rows.filter(p=>p[facets[q.kind]]===q.value);
        if (!rows.length) return fail();
        title = `${q.value} — ${title}`; crumbs.push({name:q.value,href:path});
      } else {
        title = `${title} by ${q.kind === 'categories' ? 'Category' : q.kind === 'themes' ? 'Theme' : 'Organization'}`;
        const groups = collections(rows).filter(c=>c.kind===q.kind);
        if (!groups.length) return fail();
        content = `<h1>${escapeHtml(title)}</h1><p>Browse ${rows.length} archived problem statements across ${groups.length} ${q.kind}. Labels and counts come from this edition’s source data.</p><div class="ssr-card-grid">${groups.map(c=>`<article class="ssr-card"><h2>${link(collectionPath(h.id,e.id,c.kind,c.value),c.value)}</h2><p>${c.count} problem statements</p></article>`).join('')}</div>`;
      }
    }
    const counts = [...new Set(rows.map(p=>p.category).filter(Boolean))].map(v=>`${rows.filter(p=>p.category===v).length} ${v.toLowerCase()}`).join(', ');
    description = clamp(`Browse ${rows.length} ${q.value ? `${q.value} ` : ''}${e.name} problem statements. Search by PS number, read the briefs, compare and shortlist ideas.`);
    content ||= `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>${escapeHtml(counts)}. This independent collection preserves the archived briefs; consult each statement’s source for current requirements.</p>${collectionLinks(h.id,e.id,rows)}${listing(rows)}`;
  } else if (h) {
    title = `${h.name} Problem Statements`; description = clamp(`Explore ${h.name} problem statements across ${h.editions.length} archived editions. Search previous years by theme, organization, category and PS number.`);
    content = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><div class="ssr-card-grid">${h.editions.map(e=>`<article class="ssr-card"><h2>${link(editionPath(h.id,e.id),`${e.name} Problem Statements`)}</h2><p>${e.stats.problems} archived statements</p></article>`).join('')}</div>`;
  } else {
    if (!['/','/hackathons','/browse'].includes(pathname) && pathname !== '/api/statement') return fail();
    path = pathname === '/api/statement' ? '/' : pathname;
    title = path === '/hackathons' ? 'Hackathon Archives' : path === '/browse' ? 'Browse Hackathon Problem Statements' : 'Hackathon Problem Statements — Search & Shortlist';
    description = `Search ${all.length} archived hackathon problem statements, including Smart India Hackathon editions. Browse themes and organizations, compare and shortlist.`;
    if (path === '/browse') {rows=all;content=`<h1>Browse hackathon problem statements</h1><p>${description}</p>${listing(rows)}`;}
    else content = `<h1>${path === '/' ? 'Hackathon problem statements.' : 'Hackathon archives'}</h1><p>Search, compare and shortlist a problem worth building. Explore hackathons, previous editions, themes and organizations.</p><p>${all.length} archived statements · ${getHackathons().length} hackathons</p><div class="ssr-card-grid">${getHackathons().map(h=>`<article class="ssr-card"><h2>${link(hackathonPath(h.id),h.name)}</h2><p>${escapeHtml(h.description)}</p><nav class="hero-links">${h.editions.map(e=>link(editionPath(h.id,e.id),e.name)).join('')}</nav></article>`).join('')}</div>`;
  }
  const url = origin+path;
  const graph = [{ '@type':type, name:title, url, description, ...(rows.length ? {mainEntity:{'@type':'ItemList',numberOfItems:rows.length,itemListElement:rows.map((p,i)=>({'@type':'ListItem',position:i+1,name:p.title,url:origin+problemPath(p)}))}} : {}), ...(p ? {about:{'@type':'CreativeWork',name:p.title,identifier:p.external_id || p.id}}:{}) }];
  if (path === '/') graph.push({'@type':'WebSite',name:'HackVault',url:origin+'/',description});
  if (crumbs.length>1) graph.push({'@type':'BreadcrumbList',itemListElement:crumbs.map((c,i)=>({'@type':'ListItem',position:i+1,name:c.name,item:origin+c.href}))});
  const body = `<div class="ssr-wrap">${crumbs.length>1 ? `<nav class="ssr-breadcrumb" aria-label="Breadcrumb">${crumbs.map((c,i)=>i===crumbs.length-1 ? `<span aria-current="page">${escapeHtml(c.name)}</span>`:link(c.href,c.name)).join('<span aria-hidden="true">/</span>')}</nav>`:''}${content}</div>`;
  return {status:200,title:`${title} | HackVault`,description,path,body,ld:{'@context':'https://schema.org','@graph':graph}};
}
