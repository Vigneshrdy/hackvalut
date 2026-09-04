# Data Format

## Directory Layout

```text
data/
  <hackathon-id>/
    hackathon.json
    <edition-id>/
      edition.json
      problems/
        <problem-id>.md
```

## Hackathon Metadata

Required:

- `id`
- `name`

Optional:

- `shortName`
- `description`
- `website`
- `logo`
- `license`
- `attribution`
- `source_url`

## Edition Metadata

Required:

- `id`
- `name`

Optional:

- `year`
- `status`
- `description`

## Problem Markdown

Required frontmatter:

- `id`
- `title`

Optional frontmatter:

- `external_id`
- `organization`
- `department`
- `category`
- `theme`
- `source_url`
- `tags`

Body sections are free-form Markdown. `## Problem Statement`, `## Expected Solution`, and `## Dataset` are recognized when present.

## Validation Rules

- Hackathon IDs must be unique lowercase slugs.
- Edition IDs must be unique within a hackathon.
- Problem IDs must be unique within an edition.
- Canonical `problem_key`s must be globally unique.
