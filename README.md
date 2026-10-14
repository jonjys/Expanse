# Expanse

The internet, as a universe. A map of real products shaped like a spiral galaxy: search by the problem you have,
compare products in a list, and add your own. Live at <https://expanse.nyttolabs.com> (the old address, expanse-inky.vercel.app, redirects there).

## Structure

- `index.html` — markup and CSS. `app.js` — all the behaviour. No build step, no external dependencies.
- `api/p.js` — serves `/p/<slug>` (product pages) with the product's own title, description and share image in the `<head>`.
- `vercel.json` — the `/p/<slug>` rewrite and a few security headers.
- `supabase/migrations/` — the database schema (already applied to the Supabase project). `supabase/functions/verify-domain/` — the domain check.
- `fonts/` — Instrument Sans and IBM Plex Mono, subset to Latin WOFF2. `favicon.svg`, `og.jpg` — browser icon and 1200×630 share image.

Vercel deploys the repo root: every push to `main` goes to production, every other branch gets a preview URL.

## What's on the map

- **Live products** — glowing squares in their category colour. Only products that passed review are shown.
- **Held spots** — white beacons: products still in review, and founding reservations from the earlier version of the site.
- **Galaxy dust** — the faint stars that give the galaxy its shape. They are decoration, not products.
- **Demo mode** (the DEMO button, or `#demo` in the URL) fills the galaxy with about 13,000 clearly labelled example squares
  from a fixed seed, to show what a full universe looks like. Nothing in demo mode is real, and examples never block a real spot.

## Search and list

Search ranks products by relevance only: the problems they solve (`needs`), name, tagline, integrations, category, audience,
platforms and description. Map position, zone, price and the sponsored flag never affect ranking. The list view has filters
for category, price (has a free option / paid), platform and integrations.

## Zones and founding prices

Per cell; a 2×2 is four cells and an 8×8 landmark sixty-four.

| Zone       | Radius  | Price          |
|------------|---------|----------------|
| Core       | < 14    | invite only    |
| Inner ring | 14–40   | €19 / cell     |
| Belt       | 40–80   | €9 / cell      |
| Outer rim  | 80–125  | €4 / cell      |
| Edge       | 125+    | €1 / cell      |

The same table lives in `ZONES` in `app.js` and in `zone_of()` / `price_per_cell()` in Supabase — change both together.
Nothing is charged today: listing is free and spots are free to hold. The terms shown on the site for when paid placement
opens are in the "How it works" sheet in `index.html` (12 months at the founding price, or move to the free outer edge).

## Makers: owner key and verification

- Adding a product returns an **owner key** (shown once, saved in the browser, downloadable). Only its SHA-256 hash is stored.
  The key opens the owner panel: stats, edit, verify, share, take the listing down.
- **Domain verification**: the owner publishes `<meta name="expanse-verification" content="TOKEN">` on their home page, or a file
  at `/.well-known/expanse-verification.txt`. The `verify-domain` edge function fetches only the product's own domain (https,
  same-site redirects, size and time limits) and sets `verified_at`. Verification is separate from payment.
- **Lost key**: "I make this" → "Lost your key?" gives a recovery token to publish on the site plus a secret kept in that browser.
  When the site shows the token, the function issues a new key and the old one stops working.
- Text edits go live immediately. A new link or new images send the product back to review; a new domain clears verification.

## Stats

`track()` counts profile views, website clicks and demo clicks — once per visitor per product per day — using a hash of IP and
user agent with a salt that is replaced every day. No cookies, no stored IP addresses. Known bots are ignored, and hashes that
opened the owner panel that day are left out of the owner's numbers. The owner sees the last 30 days.

## Review and reports (for whoever runs Expanse)

New products start as `pending` and are not public until approved. In the Supabase dashboard → project **expanse**:

- **Table Editor → `moderation_queue`** lists everything waiting: pending products and live products with open reports.
- To approve: Table Editor → `products` → set `status` to `approved` (`approved_at` is filled in automatically).
- To turn one down: set `status` to `rejected` and write the reason in `review_note` — the owner sees it and can resubmit.
- To hide a live product after reports: set `status` to `hidden` (and a `review_note`). Mark reports handled with `resolved = true`.
- `sponsored` marks a paid placement. It only adds a "Sponsored" label; it never changes search.

```sql
-- waiting for review
select id, name, url, category, contact_email, created_at from products where status = 'pending' order by created_at;
-- open reports
select p.name, r.reason, r.details, r.created_at from reports r join products p on p.id = r.product_id where not r.resolved order by r.created_at;
```

Deletion requests: take the listing down from the owner panel (wipes the email and key), or set `status = 'removed'` and
replace `contact_email`.

## Supabase API

The browser only talks to these RPC functions; no table is readable or writable through the API.

| Function | What it does |
|---|---|
| `public_products()` / `public_product(slug)` | Approved products. |
| `public_spots()` | Held spots without a live profile (white beacons). |
| `founding_stats()` | Count of held spots, live products, and the 12 latest events for the LIVE feed (no emails). |
| `submit_product(p)` | Validates and stores a new product (pending), returns the owner key once. |
| `owner_get` / `owner_update` / `owner_stats` / `owner_remove` | Owner panel, all checked against the owner key. |
| `track(slug, kind)` / `report_product(slug, reason, details)` | Visit counting and reports. |
| `start_recovery(slug)` | Starts the lost-key flow. |
| `referral_count(code)` | "Invite 3 makers → +1 cell" progress. |
| `reserve_spot(...)`, `reserve(...)` | Founding reservations from the earlier version; kept so old links keep working. |

Functions starting with `_` are internal and not callable through the API; the edge function reaches them over the database connection.
