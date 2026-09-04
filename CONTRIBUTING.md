# Contributing To HackVault Framework

## What You Can Contribute

- Add a new hackathon dataset
- Add a new edition to an existing hackathon
- Add or fix problem statement Markdown
- Improve the framework code, docs, or validation checks

## Catalog Contributions

### Add a hackathon

```bash
mkdir -p data/<hackathon-id>
```

Create `data/<hackathon-id>/hackathon.json`:

```json
{
  "id": "nasa-space-apps",
  "name": "NASA Space Apps",
  "shortName": "Space Apps",
  "description": "Public problem statement archive",
  "website": "https://www.spaceappschallenge.org/"
}
```

### Add an edition

```bash
mkdir -p data/<hackathon-id>/<edition-id>/problems
```

Create `edition.json`:

```json
{
  "id": "2026",
  "name": "NASA Space Apps 2026",
  "year": 2026,
  "status": "completed",
  "description": ""
}
```

### Add problem statements

Add Markdown files under `problems/`.

Example:

```markdown
---
id: challenge-001
title: Build a searchable archive for satellite anomaly reports
organization: Mission Data Office
theme: Space Operations
source_url: https://example.com/challenge-001
tags:
  - search
  - satellite
---

## Problem Statement

...
```

## Code Contributions

```bash
npm install
npm run dev
npm run check
```

Rules:

- Keep the architecture lightweight.
- Do not move public problem statements into PostgreSQL.
- Do not hardcode hackathon names, years, categories, themes, or identifier formats.
- Preserve the separation between anonymous public browsing and authenticated private features.

## Validation

Run before opening a PR:

```bash
npm run check
```

## Migration And Import Scripts

- Migrate legacy SIH directories: `node scripts/migrate-sih-data.js`
- Import JSON into an edition: `node scripts/import-hackathon.js --hackathon <id> --edition <id> --source ./incoming/problems.json`

## Pull Requests

- Explain what changed.
- For dataset changes, include the content source and any licensing or attribution constraints.
- Never include secrets or `.env` values.
