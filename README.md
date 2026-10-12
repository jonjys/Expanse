# Expanse

The internet, as a universe. A full-screen spiral galaxy of squares where every square is someone —
a shop, a song, a startup, a freelancer. Live at <https://expanse-inky.vercel.app>.

## Structure

- `index.html` — the whole site: markup, CSS and JS, no build step and no external dependencies.
- `fonts/` — Instrument Sans and IBM Plex Mono, subset to Latin WOFF2.
- `favicon.svg`, `og.jpg` — browser icon and the 1200×630 share image.

Vercel deploys the repo root as a static site: every push to `main` goes to production, every other branch gets a preview URL.

## The universe

- About 13,000 example squares are generated from a fixed seed, so every visitor sees the same galaxy.
  Zoomed out it is drawn from a cached texture; zoomed in, square by square with names, glow and badges.
- **Zones and founding prices** (per cell; a 2×2 is four cells, an 8×8 landmark sixty-four):

  | Zone       | Radius  | Price          |
  |------------|---------|----------------|
  | Core       | < 14    | invite only    |
  | Inner ring | 14–40   | €19 / cell     |
  | Belt       | 40–80   | €9 / cell      |
  | Outer rim  | 80–125  | €4 / cell      |
  | Edge       | 125+    | €1 / cell      |

  The same table lives in `ZONES` in `index.html` and in `zone_of()` / `price_per_cell()` in Supabase — change both together.
- The first 1,000 reservations are "founding" spots (`FOUNDING_LIMIT` in `index.html`). Nobody pays today; reserving is free.

## Real data (Supabase project `expanse`, eu-north-1)

The browser only talks to these RPC functions; the `reservations` table itself is not readable or writable through the API.

| Function | What it does |
|---|---|
| `reserve_spot(email, name, mode, x, y, size, ref)` | Upserts a reservation by email. Rejects the core and overlapping spots, computes zone and price server-side, returns the referral code and founding number. |
| `founding_stats()` | Reservation count and the 12 most recent reservations (zone, mode, size, time — no names or emails). Drives the "founding spots left" counter and the LIVE feed. |
| `public_spots()` | Positions of all reservations, drawn as white beacons on the map. |
| `referral_count(code)` | How many reservations came through someone's share link ("invite 3 friends → +1 cell"). |
| `reserve(email, name, mode, x, y)` | Legacy entry point for old cached pages; delegates to `reserve_spot`. |

To see the list: Supabase dashboard → project **expanse** → Table Editor → `reservations`, or

```sql
select created_at, email, name, mode, zone, size, price_eur, code, referred_by
from reservations order by created_at;
```

Deletion requests: delete the person's row by email.

## Sharing

- A visitor's own square is stored in their browser (`localStorage`, key `expanse.mine.v2`).
- "Share my square" creates a link with the square in the URL hash (`#s=…`, including the referral code once reserved).
  Friends who open it see the square, get "Claim the spot next to …", and their reservation counts as a referral.
- "Square card" renders a 1080×1350 image of your square in the galaxy, shared natively on phones or downloaded on desktop.
