# HackVault Framework

HackVault Framework is a lightweight, Markdown-backed system for browsing, filtering, reviewing, and shortlisting hackathon problem statements.

Smart India Hackathon is one dataset running on the framework. The architecture is generic: add another hackathon under `data/` and the site discovers it automatically.

## Why

- Public problem statements belong in version control, not in opaque admin panels.
- Maintainers should be able to add hackathons with files and metadata, not JavaScript edits.
- Private collaboration features still matter: shortlists, notes, team votes, comments.

## Architecture

```text
Markdown Catalog
      |
      v
Generic Parser
      |
      +----> Public API
      |
      +----> Server-rendered pages
      |
      v
Browser UI

Private features:

Browser
   |
   v
Authenticated API
   |
   v
Supabase/PostgreSQL
```

## Features

- Hackathon-first browsing: hackathon -> edition -> problem statement
- Global search across hackathon name, edition, ID, title, org, department, category, theme, tags, and text
- Dynamic filters derived from the loaded catalog
- Server-rendered crawlable public pages
- Local shortlist and compare without authentication
- Authenticated private notes, reading state, decisions, team votes, and team comments
- Markdown as the public source of truth

## Data Organization

```text
data/
  smart-india-hackathon/
    hackathon.json
    2024/
      edition.json
      problems/
        SIH1524.md
    2025/
      edition.json
      problems/
        SIH25001.md
    2026/
      edition.json
      problems/
        SIH26001.md
  open-innovation-demo/
    hackathon.json
    season-1/
      edition.json
      problems/
        WEB-7.md
```

See `docs/DATA_FORMAT.md` for the full schema.

## Add A Hackathon

1. Create `data/<hackathon-id>/hackathon.json`.
2. Create `data/<hackathon-id>/<edition-id>/edition.json`.
3. Add Markdown files in `data/<hackathon-id>/<edition-id>/problems/`.
4. Run `npm run check`.

Example:

```bash
mkdir -p data/nasa-space-apps/2026/problems
```

## Add An Edition

Create a new edition directory under an existing hackathon:

```bash
mkdir -p data/smart-india-hackathon/2027/problems
```

Then add `edition.json` and problem Markdown files.

## Add A Problem Statement

Each problem statement file uses YAML frontmatter followed by Markdown sections.

```markdown
---
id: SIH25001
external_id: SIH25001
title: AI Based Landslide Monitoring System
organization: Ministry of Development of North Eastern Region
department: MDoNER
category: Software
theme: Disaster Management
source_url: https://example.com
tags:
  - AI
  - GIS
---

## Problem Statement

...

## Expected Solution

...
```

Only `id` and `title` are required.

## Running Locally

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000` by default.

## Supabase Setup

Supabase is only required for private features.

1. Run `supabase/schema.sql` in the Supabase SQL editor.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`.

## Deployment

The public catalog remains filesystem-backed. Vercel functions that read it include `data/**` in their bundles.

Deploy steps:

1. Import the repository into Vercel.
2. Configure environment variables.
3. Set `APP_ORIGIN` to the deployed domain.
4. Deploy.

## Import Tools

- `node scripts/migrate-sih-data.js`
- `node scripts/import-hackathon.js --hackathon <id> --edition <id> --source <json>`

## Validation

```bash
npm run check
```

This validates the catalog layout, uniqueness rules, parser behavior, deployment wiring, and the generic identifier model.

## Contribution Workflow

See `CONTRIBUTING.md`.

## Security Model

- Public catalog routes are anonymous and CDN-cacheable.
- Private review/team/comment routes require a verified Supabase access token.
- Refresh tokens stay in HttpOnly cookies.
- Team limits and integrity rules stay enforced in PostgreSQL.

## License And Attribution

The software is MIT-licensed under `LICENSE`.

Problem statement text is not owned by HackVault. Attribution, licensing notes, and source responsibilities are documented in `ATTRIBUTION.md`. Contributors are responsible for ensuring they have the right to redistribute submitted content.
