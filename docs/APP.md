# App

The browser app is a vanilla JavaScript interface on top of the HackVault catalog.

## Public Experience

- Home page introduces hackathons first
- Hackathon page lists editions
- Edition page provides filtering, search, shortlist, compare, and review board workflows
- Problem detail pages expose full content and metadata

## Private Experience

After sign-in, users can:

- save reading state
- save decisions
- save private notes
- create or join teams
- vote as a team
- post team comments

## Data Flow

1. Browser loads `/api/problems` for the public catalog.
2. The app filters client-side for responsiveness.
3. Authenticated actions call `/api/reviews`, `/api/team`, and `/api/comments`.

## Notes

- Local shortlist and compare use `problem_key` in localStorage.
- The app no longer assumes SIH-only IDs, years, categories, or route shapes.
