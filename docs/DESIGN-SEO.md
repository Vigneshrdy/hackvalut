# HackVault Design And SEO Notes

This document records the product, design, and SEO decisions behind the 2026 HackVault refresh.

## Audience And Search Intent

HackVault is built for students and teams who are comparing real hackathon problem statements before committing to an idea. The useful search patterns are mostly exact and archival:

- PS number searches such as `SIH26038`
- year searches such as `SIH 2026 problem statements` and `SIH 2025 problem statements`
- theme, organization, and category searches
- previous-year and archive searches
- dataset/resource searches for statements that mention data

Research also showed a separate "write me a hackathon problem statement" intent. HackVault does not try to answer that with generic idea copy. It preserves and exposes the original briefs, expected solutions, datasets, organizations, themes, and source links.

Useful references checked during the refresh:

- Google canonical URL guidance: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- SIH idea submission PDF: https://www.sih.gov.in/pdf/IdeasubmissionprocessSIH2020.pdf
- SIH student FAQ PDF: https://www.sih.gov.in/pdf/Student%20FAQs.pdf
- ISRO VEDAS SIH 2024 archive: https://vedas.sac.gov.in/en/sih2024.html
- A competing SIH archive with faceted browsing: https://sih2026.vuce.in/
- GitHub SIH 2026 archive example: https://github.com/sea-deep/sih2026-problem-statements

Google Trends and autocomplete checks were attempted, but the available tooling returned errors. No search-volume, trend, or autocomplete claims were used.

## Visual Direction

The interface is now a quiet archive tool: compact cards, clear metadata, dense filters, and restrained color. The old newspaper/editorial styling was replaced with a system sans-serif stack and a neutral palette so long problem statements remain readable.

Main design choices:

- Keep search and filters prominent in the sticky header.
- Use compact cards for repeated problem statements.
- Keep detail pages in a readable text column with a metadata rail.
- Avoid marketing-page composition; the first screen is the working archive.
- Preserve full statement text on detail pages and in server-rendered HTML.
- Keep mobile navigation stable with a bottom-sheet filter drawer and trapped focus.

## URL Model

Canonical public URLs are generated from `catalog-urls.js`:

- `/`
- `/browse`
- `/hackathons`
- `/hackathons/:hackathon`
- `/hackathons/:hackathon/:edition`
- `/hackathons/:hackathon/:edition/problems/:problem`
- `/hackathons/:hackathon/:edition/themes`
- `/hackathons/:hackathon/:edition/themes/:theme`
- `/hackathons/:hackathon/:edition/organizations`
- `/hackathons/:hackathon/:edition/organizations/:organization`
- `/hackathons/:hackathon/:edition/categories`
- `/hackathons/:hackathon/:edition/categories/:category`

Facet values use the original source labels with URL encoding instead of lossy slugs. That avoids collisions between similar organization/theme names and keeps link generation reversible.

Legacy `/problem-statements` routes now redirect to the current Smart India Hackathon 2026 route.

## Crawlable HTML

`lib/seo.js` renders public pages on the server with:

- one canonical URL per page
- unique titles and descriptions
- visible headings and breadcrumbs
- full detail-page statement text
- collection pages for themes, organizations, and categories
- JSON-LD for website, collection, problem detail, item list, and breadcrumbs
- `noindex, follow` for 404s and query-filtered pages

The sitemap currently exposes 807 canonical public URLs: 618 problem detail pages plus archive, edition, browse, and collection pages.

## Icons And Social Assets

All favicon and app icon files live in `icons/`:

- `icons/favicon.svg`
- `icons/favicon.ico`
- `icons/favicon-16x16.png`
- `icons/favicon-32x32.png`
- `icons/favicon-48x48.png`
- `icons/apple-touch-icon.png`
- `icons/android-chrome-192x192.png`
- `icons/android-chrome-512x512.png`

`scripts/generate-brand.py` regenerates the deterministic mark and the raster icons into that folder. The Open Graph image remains at `/og-image.png` because social crawlers conventionally fetch a page-level preview asset and it is not a favicon.

## Deployment Notes

Set `APP_ORIGIN` to the deployed origin so canonical URLs, Open Graph URLs, robots, and sitemap output are absolute and stable.

`/robots.txt` is served dynamically by `api/robots.js` on Vercel. The root `robots.txt` is kept neutral for static hosts.

After deployment, submit `/sitemap.xml` in Google Search Console and inspect several detail and collection URLs. Local tests verify HTML and links; Search Console is still needed for real crawl status, indexing decisions, and field data.

## Verification

Current checks:

```bash
npm run check
BASE_URL=http://localhost:3000 npm run check:seo
BASE_URL=http://localhost:3000 npm run check:browser
BASE_URL=http://localhost:3000 npm run check:audit
BASE_URL=http://localhost:3000 npm run check:e2e
```

The audit script uses axe on sampled public routes and records local browser layout-shift values. These are local regression signals, not production Core Web Vitals.
