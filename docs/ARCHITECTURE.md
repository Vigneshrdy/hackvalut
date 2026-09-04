# Architecture

HackVault Framework keeps public problem statements in Markdown and serves them through a static frontend plus Vercel serverless functions.

## Public Catalog

- Source of truth: `data/**`
- Loader: `lib/catalog.js`
- Public APIs: `api/problems`, `api/hackathons`, `api/sitemap`
- Server-rendered public pages: `api/statement.js`

The catalog is parsed from the local filesystem once per serverless instance and cached at module scope.

## Private Features

Supabase/PostgreSQL remains responsible for:

- sessions
- teams
- private reviews
- private notes
- team votes
- team comments
- rate limiting

The database stores `problem_key`, not public statement text.

## Canonical Problem Identity

Format:

```text
hackathon-id:edition-id:problem-id
```

Example:

```text
smart-india-hackathon:2026:SIH26001
open-innovation-demo:season-1:WEB-7
```

## Routing

- `/`
- `/hackathons`
- `/hackathons/:hackathonId`
- `/hackathons/:hackathonId/:editionId`
- `/hackathons/:hackathonId/:editionId/problems/:problemId`

Legacy SIH links under `/problem-statements/:id` are retained as aliases.

## Deployment Notes

`vercel.json` includes `data/**` in the function bundles for catalog-backed routes.

## Security Notes

- Public catalog routes stay anonymous.
- Private routes still require verified Supabase JWTs.
- Refresh tokens remain HttpOnly cookies.
- Team constraints remain enforced in SQL.
