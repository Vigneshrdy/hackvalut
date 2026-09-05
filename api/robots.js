import { originFor } from '../lib/seo.js';
export default function handler(request,response) {
  response.status(200);response.setHeader('Content-Type','text/plain; charset=utf-8');
  response.setHeader('Cache-Control','public, max-age=3600');
  return response.send(`User-agent: *\nAllow: /\n\nSitemap: ${originFor(request)}/sitemap.xml\n`);
}
