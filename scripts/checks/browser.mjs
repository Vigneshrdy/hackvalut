import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.BASE_URL || 'http://localhost:3000';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const wait=async selector=>page.locator(selector).first().waitFor({state:'visible'});
const edition='/hackathons/smart-india-hackathon/2026';
async function loaded(path) {await page.goto(base+path);await wait('#spa-root:not([hidden])');}
try {
  await loaded('/');assert.match(await page.title(),/Hackathon Problem Statements/);
  await page.locator('#hackathon-grid .catalog-card').first().click({position:{x:12,y:12}});await page.waitForURL(/\/hackathons\//);await page.goBack();await wait('#hackathon-grid .catalog-card');
  await page.locator('#hackathon-grid .catalog-card').first().focus();await page.keyboard.press('Enter');await page.waitForURL(/\/hackathons\//);await page.goBack();await wait('#hackathon-grid .catalog-card');
  await page.keyboard.press('/');assert.equal(await page.locator('#search').evaluate(n=>n===document.activeElement),true);
  await page.locator('#search').fill('SIH26038');await wait('.problem-card');await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');
  assert.match(await page.locator('.problem-card').innerText(),/SIH26038/);
  await page.locator('.card-main h2 a').click();await wait('#detail-title');
  assert.ok((await page.locator('link[rel=canonical]').getAttribute('href')).endsWith('/problems/SIH26038'));
  await page.locator('#copy-md').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/id: SIH26038/);
  await page.locator('#ask-ai').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Identify requirements/);
  await page.locator('#detail-star').click();assert.equal(await page.locator('#detail-star').getAttribute('aria-pressed'),'true');
  await loaded('/');await page.locator('#nav-shortlist').click();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');
  assert.match(await page.locator('.problem-card').innerText(),/SIH26038/);
  await loaded(edition);await page.locator('#filter-button').click();await page.locator('#category-filter').selectOption('Software');
  await page.locator('#filter-close').click();assert.equal(await page.locator('#filter-badge').innerText(),'1');
  const software=Number(await page.locator('#result-count').innerText());assert.ok(software>0&&software<233);
  await page.locator('#active-filters button').click();assert.equal(await page.locator('#result-count').innerText(),'233');
  await page.locator('#load-more').click();assert.equal(await page.locator('.problem-card').count(),24);
  await page.locator('[data-compare]').nth(0).click();await page.locator('[data-compare]').nth(1).click();await page.locator('#open-compare').click();await wait('#compare-dialog[open]');assert.equal(await page.locator('#compare-content .compare-card').count(),2);await page.keyboard.press('Escape');
  const download=page.waitForEvent('download');await page.locator('#export-board').click();assert.match((await download).suggestedFilename(),/\.(md|json|csv)$/);
  await page.locator('.card-main h2 a').first().click();await wait('#detail-title');const first=await page.locator('#detail-title').innerText();
  await page.locator('#detail-next').click();await page.waitForFunction(title=>document.querySelector('#detail-title').textContent!==title,first);
  await page.locator('#detail-prev').click();await page.waitForFunction(title=>document.querySelector('#detail-title').textContent===title,first);
  await page.reload();await wait('#detail-title');assert.equal(await page.locator('#detail-title').innerText(),first);
  await page.locator('[data-set-reading]').first().click();await wait('#access-gate[open]');
  await page.locator('#auth-mode [data-mode=signup]').click();assert.equal(await page.locator('#auth-password').getAttribute('autocomplete'),'new-password');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#access-gate').evaluate(n=>n.open),false);
  await page.locator('#theme-toggle').click();await page.reload();assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('dark')),true);
  await page.locator('#detail-back').click();await wait('.problem-card');
  await page.locator('#search').fill('no-match-zzzzzz');await wait('#empty-state:not([hidden])');await page.locator('#empty-clear').click();await wait('.problem-card');
  const themePath=edition+'/themes/'+encodeURIComponent('Blockchain & Cybersecurity');
  await loaded(themePath);assert.match(await page.locator('#page-title').innerText(),/Blockchain & Cybersecurity/);assert.ok(Number(await page.locator('#result-count').innerText())>0);
  await page.locator('#browse-collections a').first().click();await wait('#ssr-content');assert.match(await page.locator('#ssr-content h1').innerText(),/by Theme/);
  for(const width of [320,375,430,768,1024,1440,1920]) {
    await page.setViewportSize({width,height:900});
    for(const path of ['/',edition,edition+'/problems/SIH26038']) {
      await loaded(path);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}: ${path}`);
      assert.equal(await page.locator('h1:visible').count(),1,`one visible H1 at ${width}: ${path}`);
    }
    await page.locator('#join-group-button').click();await wait('#access-gate[open]');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`auth overflow ${width}`);await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:375,height:850});await loaded(edition);await page.locator('#filter-button').click();
  assert.equal(await page.locator('#filters').evaluate(n=>n.getBoundingClientRect().width),375);
  await page.locator('#team-vote').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#clear-filters').evaluate(n=>n===document.activeElement),true,'drawer traps keyboard focus');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#filters').evaluate(n=>n.inert),true);
  const missing=await page.goto(base+'/missing-page');assert.equal(missing.status(),404);assert.match(await page.locator('h1:visible').innerText(),/not in the archive/);
  await page.route('**/api/problems',route=>route.abort());await page.goto(base+edition+'/problems/SIH26038');await wait('#ssr-content');assert.ok((await page.locator('#ssr-content').innerText()).includes('SIH26038'),'SSR stays available on network failure');
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: search, filters, drawer, shortlist, compare, export, detail navigation, refresh, clipboard, auth UI, dark mode, network fallback, 404, and 7 responsive widths.');
} finally {await browser.close();}
