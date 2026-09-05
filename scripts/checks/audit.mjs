import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE_URL || 'http://localhost:3000';
const routes = ['/', '/browse', '/hackathons/smart-india-hackathon/2026', '/hackathons/smart-india-hackathon/2026/problems/SIH26038', '/hackathons/smart-india-hackathon/2026/themes/Blockchain%20%26%20Cybersecurity'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const results = [];

try {
  for (const path of routes) {
    await page.addInitScript(() => {
      window.__hackvaultVitals = { cls: 0, lcp: 0 };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__hackvaultVitals.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries.at(-1);
        if (last) window.__hackvaultVitals.lcp = Math.round(last.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    await page.locator('#spa-root:not([hidden]), #ssr-content:not([hidden])').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const axe = await new AxeBuilder({ page }).exclude('#toast').analyze();
    assert.equal(axe.violations.length, 0, `${path}: ${axe.violations.map(v => `${v.id} (${v.nodes.length})`).join(', ')}`);
    const vitals = await page.evaluate(() => window.__hackvaultVitals);
    assert.ok(vitals.cls < 0.1, `${path}: CLS ${vitals.cls}`);
    results.push(`${path} cls=${vitals.cls.toFixed(3)} lcp=${vitals.lcp}ms`);
  }
  console.log(`Audit checks passed: axe clean and CLS < 0.1 on ${routes.length} public routes.`);
  console.log(results.join('\n'));
} finally {
  await browser.close();
}
