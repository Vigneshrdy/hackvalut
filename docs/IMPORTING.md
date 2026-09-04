# Importing

## Legacy SIH Migration

```bash
node scripts/migrate-sih-data.js
```

This reads the legacy `2024/`, `2025/`, and `2026/` directories and generates `data/smart-india-hackathon/...`.

## Generic JSON Import

```bash
node scripts/import-hackathon.js \
  --hackathon smart-india-hackathon \
  --edition 2027 \
  --source ./incoming/problems.json
```

The importer validates required fields, prevents overwrites, and writes Markdown files into the target edition.
