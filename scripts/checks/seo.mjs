import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler from '../../api/statement.js';
import sitemap from '../../api/sitemap.js';
import robots from '../../api/robots.js';
import { publicPaths } from '../../lib/seo.js';
import { getProblems } from '../../lib/catalog.js';
import { problemPath } from '../../catalog-urls.js';
const origin='https://hackvault.example';
process.env.APP_ORIGIN=origin;
function queryFor(path) {
  const parts=path.split('/').filter(Boolean).map(decodeURIComponent);
  if(parts[0]!=='hackathons') return {};
  return {hackathon:parts[1] || '',edition:parts[2] || '', ...(parts[3]==='problems' ? {problem:parts[4]} : {kind:parts[3] || '',value:parts[4] || ''})};
}
async function render(fn,path,query=queryFor(path)) {
  const response={code:0,headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k.toLowerCase()]=v;},send(body){this.body=body;return this;}};
  await fn({method:'GET',url:path,headers:{host:'hackvault.example'},query},response);return response;
}
const paths=publicPaths();assert.equal(new Set(paths).size,paths.length,'unique canonical URLs');
const titles=new Set();
for(const path of paths) {
  const result=await render(handler,path);
  assert.equal(result.code,200,path);
  assert.ok(result.body.includes(`rel="canonical" href="${origin+path}"`),`canonical ${path}`);
  const title=result.body.match(/<title>(.*?)<\/title>/)[1];assert.ok(!titles.has(title),`unique title ${path}`);titles.add(title);
  assert.ok(result.body.includes('<h1>'),`server H1 ${path}`);
  assert.ok(!result.body.includes('content="noindex'),`indexable ${path}`);
  const ld=JSON.parse(result.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);assert.ok(ld['@graph'].length);
  assert.match(result.body,/og:image" content="https:\/\/hackvault.example\/og-image.png/);
}
for(const p of getProblems()) {
  const result=await render(handler,problemPath(p));
  const escape = s=>s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  assert.ok(result.body.includes(escape(p.title)),`${p.key}: title is rendered`);
  if(p.description) assert.ok(result.body.includes(escape(p.description)),`${p.key}: full description is rendered`);
}
const xml=await render(sitemap,'/sitemap.xml',{});assert.equal((xml.body.match(/<loc>/g)||[]).length,paths.length);assert.ok(!xml.body.includes('lastmod'),'no invented modification dates');
assert.ok((await render(robots,'/robots.txt',{})).body.includes(`${origin}/sitemap.xml`));
for(const path of ['/hackathons/missing','/hackathons/smart-india-hackathon/2099','/hackathons/smart-india-hackathon/2026/problems/missing','/hackathons/smart-india-hackathon/2026/themes/missing']) {
  const r=await render(handler,path);assert.equal(r.code,404);assert.equal(r.headers['x-robots-tag'],'noindex, follow');
}
assert.equal((await render(handler,'/browse?q=AI',{})).headers['x-robots-tag'],'noindex, follow');
const legacy=await render(handler,'/problem-statements/SIH26001',{legacyId:'SIH26001'});assert.equal(legacy.code,301);assert.ok(legacy.headers.location.endsWith('/problems/SIH26001'));
const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
for(const icon of manifest.icons) assert.ok(fs.existsSync('.'+icon.src));
for(const file of ['icons/favicon.svg','icons/favicon.ico','icons/favicon-16x16.png','icons/favicon-32x32.png','icons/favicon-48x48.png','icons/apple-touch-icon.png','og-image.png','404.html']) assert.ok(fs.statSync(file).size>0);
const image=fs.readFileSync('og-image.png');assert.equal(image.readUInt32BE(16),1200);assert.equal(image.readUInt32BE(20),630);
console.log(`SEO checks passed: ${paths.length} canonical pages, ${getProblems().length} complete statements, metadata, redirects, 404s, sitemap and assets.`);
if(process.env.BASE_URL) {
  const queue=[...paths,'/robots.txt','/sitemap.xml','/manifest.webmanifest','/icons/favicon.svg','/icons/favicon.ico','/icons/apple-touch-icon.png','/og-image.png'];
  await Promise.all(Array.from({length:6},async()=>{while(queue.length){const path=queue.pop();const r=await fetch(process.env.BASE_URL+path);assert.equal(r.status,200,path);await r.arrayBuffer();}}));
  console.log('All sitemap URLs and public assets return HTTP 200.');
}
