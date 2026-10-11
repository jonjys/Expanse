# Expanse

Landing page for Expanse — a living map of people who sell, create, build and get hired.
Live at <https://expanse-inky.vercel.app>.

## Structure

- `index.html` — the whole site: markup, CSS and JS, no build step and no external dependencies.
- `fonts/` — Instrument Sans and IBM Plex Mono, subset to Latin WOFF2.
- `favicon.svg`, `og.jpg` — browser icon and the 1200×630 share image.

Vercel deploys the repo root as a static site: every push to `main` goes to production, every other branch gets a preview URL.

## The map

The map is a preview. Every square on it is generated example data (seeded, so it is the same for every visitor).
A visitor's own square is stored in their browser (`localStorage`, key `expanse.mine.v1`), and the
"Share my square" link carries it in the URL hash (`#s=…`) so friends see it and can claim the spot next to it.

## Reservations (email waitlist)

After claiming, visitors can leave their email to hold their spot until founding claims open.

- Stored in the Supabase project **expanse** (region `eu-north-1`, Stockholm), table `public.reservations`:
  one row per email with the square's name, mode and position.
- The browser can only call `public.reserve(...)`; the table itself is not readable or writable through the API.
  The publishable key in `index.html` is public by design.
- To see the list: Supabase dashboard → Table Editor → `reservations`, or run
  `select email, name, mode, x, y, created_at from reservations order by created_at;`
- Deletion requests: delete the person's row by email.
- To stop collecting emails, set `RESERVE.url` to `''` in `index.html`.
