# Expanse

The internet, as a universe. A map of real products shaped like a spiral galaxy: search by the problem you have,
compare products in a list, and add your own. Live at <https://expanse.nyttolabs.com> (the old address, expanse-inky.vercel.app, redirects there).

## Structure

- `index.html` — markup and CSS. `app.js` — all the behaviour. No build step, no external dependencies.
- `api/p.js` — serves `/p/<slug>` (product pages) with the product's own title, description and share image in the `<head>`.
- `api/sitemap.js` — serves `/sitemap.xml` with every live product page. `robots.txt` points to it.
- `admin.html` + `admin.js` — the admin page at `/admin` (review, reports, placements, products, overview, settings).
- `vercel.json` — the `/p/<slug>` and `/admin` rewrites and a few security headers.
- `supabase/migrations/` — the database schema (already applied to the Supabase project).
- `supabase/functions/verify-domain/` — the domain and GitHub checks. `supabase/functions/worker/` — background jobs
  (link checks, email, releases, embeddings). `supabase/functions/search/` — AI search.
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

**AI search** runs next to the keyword search. The `search` edge function turns the query into an embedding with
`gte-small` (run inside Supabase; the text is not sent anywhere else) and compares it with each live product's embedding
(`products.embedding`, plus one per need). Only products that clearly stand out from the rest of the catalog come back,
with the closest stated need. The browser merges both result sets and shows why each product is there ("Solves: send
invoices · Free plan · On iOS"); it also reads simple hints from the query (free, a platform, an integration).
Embeddings are made by the worker's `embed` job when a product is approved or its text changes.

## Zones and founding prices

Per cell; a 2×2 is four cells and an 8×8 landmark sixty-four.

| Zone       | Radius  | Price          |
|------------|---------|----------------|
| Core       | < 14    | the Spotlight — earned, never sold |
| Inner ring | 14–40   | €19 / cell     |
| Belt       | 40–80   | €9 / cell      |
| Outer rim  | 80–125  | €4 / cell      |
| Edge       | 125+    | €1 / cell      |

The same table lives in `ZONES` in `app.js` and in `zone_of()` / `price_per_cell()` in Supabase — change both together.
Nothing is charged today: listing is free and spots are free to hold. The terms shown on the site for when paid placement
opens are in the "How it works" sheet in `index.html` (12 months at the founding price, or move to the free outer edge).

## The Spotlight (the core)

Nobody can pick a spot in the core. Its 8 places (a ring of 4×4 squares, `SPOT_SLOTS` in `app.js`) show the products
people actually use: live, verified domain, website answered in the last 3 days, not kept out by the admin; ranked by
popularity (below); ties go to the product that went live first. While fewer than 8
products qualify, every one that does gets a place. `public_spotlight()` returns the picks and recalculates them
(`_spotlight_refresh()`, stored in `settings.spotlight`) when they are over an hour old, and right after a domain is
verified. The admin can keep a product out ("Keep out of Spotlight" on its card). A product in the Spotlight still
has its own spot; the core shows it a second time and links to it.

## Upvotes and popularity

Anyone can upvote a live product (▲ on the profile), no account. The browser keeps a random voter id
(`expanse.voter.v1`) and the products it upvoted (`expanse.votes.v1`); the `votes` table stores only a hash of the id,
so one browser has one vote per product and can take it back (`upvote(slug, voter, on)`). The day's visitor hash (the
same daily-salted hash as the stats) stops the same network and browser from voting twice for a product on one day by
clearing its storage, and caps a visitor at 60 votes a day. Makers can't upvote their own product (owner marks). The
admin can take back every upvote on a product (*Reset upvotes*, `admin_reset_votes`).

Popularity = unique profile views + 3 × unique clicks to the site or demo + 5 × upvotes over the last 30 days, without
the maker's own visits and votes, minus clicks that came from a Sponsored card. `_spotlight_refresh()` recalculates it
for every live product (table `popularity`, with `pct` 0–100 relative to the most popular product) at most once an
hour, and the Spotlight uses the same score. Public products carry `upvotes` (live count) and `pop` (the `pct`).
Search ranks by how well a product matches first and multiplies by up to 1.35 for popularity, so a popular product can
pass a slightly closer match but never a much closer one. The list without a search, and "Most popular", sort by `pop`
then upvotes. While the search dropdown is open, the top matches light up on the map and the best one gets a label.

## Following and updates

Visitors can follow any product (★ on the profile). The list of followed products is kept in the browser only — no account,
nothing stored about the visitor. The ★ Following button shows one combined feed from `updates`: launches, domain
verifications, profile changes (merged per day) and GitHub releases, with a count of what's new since it was last opened.

## Makers: owner key and verification

- Adding a product returns an **owner key** (shown once, saved in the browser, downloadable). Only its SHA-256 hash is stored.
  The key opens the owner panel: stats, edit, verify, share, take the listing down.
- **Domain verification**: the owner publishes `<meta name="expanse-verification" content="TOKEN">` on their home page, or a file
  at `/.well-known/expanse-verification.txt`. The `verify-domain` edge function fetches only the product's own domain (https,
  same-site redirects, size and time limits) and sets `verified_at`. Verification is separate from payment.
- **Sign in with email**: "I make this" → "Sign in with email" sends a 6-digit code (15 minutes, five tries) to the
  product's contact email. The right code gives that browser its own device key for every product listed with the address
  (`owner_keys`, hashed); the owner key keeps working. The answer never reveals whether an address is on file, and requests
  are rate-limited per address and per visitor. Device keys can be signed out from the owner panel (Key tab). Needs the
  Resend key in the admin settings; without it the dialog says email sign-in is paused.
- **Lost key**: "I make this" → "Lost your key?" gives a recovery token to publish on the site plus a secret kept in that browser.
  When the site shows the token, the function issues a new key, the old one stops working and email sign-ins are signed out.
- **GitHub releases**: in the owner panel (Verify tab) the maker names a public repo. It counts as connected when the
  product's own site links to `github.com/<owner>/<repo>`, or the repo contains `expanse-verification.txt` with the verify
  token. The worker reads the repo's public releases feed every 6 hours; releases show on the profile and in followers' feeds.
- Text edits go live immediately. A new link or new images send the product back to review; a new domain clears verification.

## Sponsored slots

A maker asks to be Sponsored for a year under "Manage my product" → Promote (preferred start, note). The admin
schedules it under Placements (start, weeks — 52 is a year — total price and an optional payment link such as a Stripe Payment Link);
the maker gets an email with the dates and the link. The admin marks it paid when the money is in. Nothing is charged
automatically, and only paid slots in their date range show on the site.

While it runs, the product can appear in a card marked "Sponsored" above the search dropdown and the list — at most
**two** such cards, taking turns when more fit: in search only when it fits (a close match — at least 40% of the best match's score — or the same category as the
best match, and not already first); in the list without a search, when it passes the filters. The ranking below never changes. Impressions and
clicks on the card are counted like the product stats (once per visitor per day, no bots, not the maker). The maker's
report shows them next to profile views and site clicks during the slot's first 30 days (or fewer so far) versus the
same number of days just before it. The yearly price makers see is set in the admin settings (empty = "we confirm the
price with you"). Placements made before the yearly change keep their old length in `weeks_v1` too.

## Stats

`track()` counts profile views, website clicks and demo clicks — once per visitor per product per day — using a hash of IP and
user agent with a salt that is replaced every day. No cookies, no stored IP addresses. Known bots are ignored, and hashes that
opened the owner panel that day are left out of the owner's numbers. The owner sees the last 30 days.

## Running Expanse: the admin page

Everything that needs a decision is at **<https://expanse.nyttolabs.com/admin>**. Sign in with an admin key
(only its SHA-256 is stored). To create the first key, run this once in the Supabase SQL editor and save the result:

```sql
select public._admin_issue();
```

- **To review** — new products plus live products that were reported or whose website stopped answering.
  *Approve* puts a product live at once; *Needs changes* sends it back with a note; *Hide* takes a live product off the
  site; *Remove* is for spam (frees the spot and wipes the maker's email and key). The maker gets an email for each decision.
- **Reports** — from visitors and from the daily link check. Mark them handled when done.
- **Placements** — Sponsored slot requests: schedule (dates, price, payment link), mark paid, decline or stop. Running
  slots show their impressions, clicks and before/after numbers.
- **Products** — everything, filterable by status, with contact email, checks and 30-day stats.
- **Overview** — live/pending counts, views and clicks over 30 days, most viewed products, background job status.
- **Settings** — an optional email address for "something is waiting" notifications, the Resend key for sending email,
  the yearly Sponsored price makers see, and *Make a new key* to rotate the admin key.

`sponsored` on a product only adds a "Sponsored" label; it never changes search. Deletion requests: the maker can take the
listing down from their owner panel, or use *Remove* in the admin page — both wipe the contact email and owner key.

## Background jobs

`pg_cron` calls the `worker` edge function every 10 minutes (secret shared through Vault as `worker_secret`):

- **Link checks** — once a day each product's website and demo link is opened (https only, up to 5 redirects, 10 s).
  Passing checks show on the profile with their date ("Website answers", "Demo works"). Three failed website checks in a
  row add an automatic report to the admin queue.
- **Embeddings** — new or changed live profiles get their AI-search vectors (also right after an admin approves).
- **GitHub releases** — every 6 hours for connected repos, from `github.com/<repo>/releases.atom` (no token needed).
- **Email** — review decisions, sign-in codes, contact messages and the admin digest. Queued emails in `outbox` go out through Resend from `expanse@nyttolabs.com`. The Resend key is stored in
  Vault as `resend_api_key`; set or replace it from the admin settings. Without a key, emails wait in the outbox.

## Email limits, contact and search engines

- **Email quota**: when Resend answers that the plan's quota is used up (the free plan allows 100 emails a day), the
  remaining emails are held until the next UTC day instead of failing, email sign-in says it's paused (makers can
  still use their owner key or domain recovery), and the admin settings show it with a *Resume now* button for after
  an upgrade.
- **Contact**: "Contact" in the footer and in How it works opens a form (`contact_message`). The message goes to the
  admin's notification email with the sender as reply-to; 3 an hour per visitor, 30 an hour in all. Without a
  notification email the form says it's paused.
- **Search engines**: `robots.txt` (keeps `/admin` out) and `/sitemap.xml` (`api/sitemap.js`: the home page plus every
  live product page, cached for an hour).

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
| `upvote(slug, voter, on)` | Upvote a product, or take the upvote back. |
| `start_recovery(slug)` | Starts the lost-key flow. |
| `public_updates(slugs)` / `public_releases(slug)` | The followed-products feed and a product's latest releases. |
| `email_signin_start(email)` / `email_signin_verify(email, code)` | Sign-in with email: sends a code, then returns a device key per product. |
| `owner_signout(slug, key, scope)` | Signs out this device (`this`) or every other email sign-in (`others`). |
| `owner_placements` / `owner_request_placement` / `owner_cancel_placement` | The Promote tab: Sponsored slot requests and reports. |
| `public_placements()` / `track_placement(id, kind)` | Running Sponsored slots, and their impressions and clicks. |
| `public_spotlight()` | The 8 Spotlight places in the core. |
| `contact_message(email, message, topic)` | The contact form. |
| `owner_set_repo(slug, key, repo)` | Names the GitHub repo to connect (checked by `verify-domain` with `repo: true`). |
| `referral_count(code)` | "Invite 3 makers → +1 cell" progress. |
| `reserve_spot(...)`, `reserve(...)` | Founding reservations from the earlier version; kept so old links keep working. |
| `admin_*(p_key, ...)` | The admin page: overview, products, status decisions, reports, placements, settings, key rotation. Each checks the admin key. |

Functions starting with `_` are internal and not callable through the API; the edge function reaches them over the database connection.
