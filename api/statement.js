import fs from 'node:fs';
import { getProblem } from '../lib/catalog.js';
import { methodNotAllowed } from '../lib/http.js';
import { describePage, escapeHtml, originFor } from '../lib/seo.js';
import { problemPath } from '../catalog-urls.js';
let shell;
function errorHtml({page, origin, noindex}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${escapeHtml(origin+page.path)}" />
    <meta name="theme-color" content="#f7f8fa" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="HackVault" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${escapeHtml(origin+'/og-image.png')}" />
    <meta property="og:url" content="${escapeHtml(origin+page.path)}" />
    <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/icons/favicon.ico" sizes="any" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <script src="/theme-init.js"></script>
    <link rel="stylesheet" href="/styles.css" />
    <script type="application/ld+json">${JSON.stringify(page.ld).replace(/</g,'\\u003c')}</script>
    <script src="/public-page.js" defer></script>
  </head>
  <body class="public-page" data-page-status="${page.status}">
    <header class="public-nav">
      <a class="brand" href="/" aria-label="HackVault home"><img class="brand-mark" src="/icons/favicon.svg" width="38" height="38" alt=""><span><strong>HackVault</strong><small>Problem statement archive</small></span></a>
      <nav aria-label="Primary"><a href="/hackathons">Hackathons</a><a href="/browse">Browse</a></nav>
    </header>
    <main class="public-main">${page.body}</main>
  </body>
</html>`;
}
export default async function handler(request,response) {
  if (!['GET','HEAD'].includes(request.method)) return methodNotAllowed(response,['GET','HEAD']);
  const origin = originFor(request);
  request.query ||= {};
  if (request.query.legacyId) {
    const legacy = getProblem('smart-india-hackathon','2026',request.query.legacyId);
    if (legacy) { response.status(301);response.setHeader('Location',origin+problemPath(legacy));return response.send(''); }
    request.query.notFound = '1';
  }
  if (new URL(request.url || '/',origin).pathname === '/problem-statements') {
    response.status(301);response.setHeader('Location',origin+'/hackathons/smart-india-hackathon/2026');return response.send('');
  }
  const page = describePage(request);
  const query = new URL(request.url || '/',origin).searchParams;
  const noindex = page.status===404 || [...query.keys()].some(k=>!['hackathon','edition','problem','kind','value'].includes(k));
  if (page.status===404) {
    response.status(page.status);
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.setHeader('Cache-Control','public, max-age=0, s-maxage=60');
    response.setHeader('X-Robots-Tag','noindex, follow');
    return response.send(request.method==='HEAD' ? '' : errorHtml({page,origin,noindex}));
  }
  let html = shell ||= fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const replaceMeta = (key,value) => { html=html.replace(new RegExp(`(<meta (?:name|property)="${key}" content=")[^"]*("[^>]*>)`),(_,a,b)=>a+escapeHtml(value)+b); };
  html=html.replace(/<title>[\s\S]*?<\/title>/,()=>`<title>${escapeHtml(page.title)}</title>`).replace(/<link rel="canonical" href="[^"]*" \/>/,()=>`<link rel="canonical" href="${escapeHtml(origin+page.path)}" />`);
  for (const key of ['description','og:description','twitter:description']) replaceMeta(key,page.description);
  for (const key of ['og:title','twitter:title']) replaceMeta(key,page.title);
  replaceMeta('og:url',origin+page.path);
  for (const key of ['og:image','twitter:image']) replaceMeta(key,origin+'/og-image.png');
  replaceMeta('robots',noindex ? 'noindex, follow' : 'index, follow');
  html=html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,()=>`<script type="application/ld+json">${JSON.stringify(page.ld).replace(/</g,'\\u003c')}</script>`)
    .replace('<section id="ssr-content" hidden></section>',()=>`<section id="ssr-content">${page.body}</section>`)
    .replace('id="boot-screen"','id="boot-screen" hidden')
    .replace('id="navbar" hidden','id="navbar"')
    .replace('<body>',`<body data-page-status="${page.status}">`);
  // Collection directories are intentionally plain HTML; collection detail pages enhance into the explorer.
  if (request.query.kind && !request.query.value) html=html.replace('<script src="/app.js" type="module"></script>','<script src="/public-page.js" defer></script>');
  response.status(page.status);
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.setHeader('Cache-Control',page.status===404 ? 'public, max-age=0, s-maxage=60':'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  if(noindex) response.setHeader('X-Robots-Tag','noindex, follow');
  return response.send(request.method==='HEAD' ? '' : html);
}
