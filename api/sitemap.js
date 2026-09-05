import { methodNotAllowed } from '../lib/http.js';
import { getProblems } from '../lib/catalog.js';
import { publicPaths, originFor, escapeHtml } from '../lib/seo.js';
export default async function handler(request,response) {
  if (!['GET','HEAD'].includes(request.method)) return methodNotAllowed(response,['GET','HEAD']);
  const origin=originFor(request);
  const xml=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',...publicPaths().map(path=>`<url><loc>${escapeHtml(origin+path)}</loc></url>`),'</urlset>'].join('\n');
  response.status(200);response.setHeader('Content-Type','application/xml; charset=utf-8');response.setHeader('Cache-Control','public, max-age=0, s-maxage=3600');
  return response.send(request.method==='HEAD' ? '' : xml);
}
