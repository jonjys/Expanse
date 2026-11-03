# Expanse

The internet, as a universe. A map of real products shaped like a spiral galaxy: search by the problem you have,
compare products in a list, and add your own. Live at <https://expanse.nyttolabs.com> (the old address, expanse-inky.vercel.app, redirects there).

## Structure

- `index.html` — markup and CSS. `app.js` — all the behaviour. No build step and no browser dependencies. The only runtime dependency is `@resvg/resvg-js`, used server-side by `api/card.js`. The regression suite uses jsdom as a development dependency.
- `api/p.js` — serves `/p/<slug>` (product pages) with the product's own title, description and generated share card in the `<head>`.
- `api/card.js` + `lib/og-card.js` — the 1200×630 PNG share card for each product (see *Sharing on X* below). `api/badge.js` + `lib/badge.js` — the embeddable "Live on Expanse" badge.
- `api/browse.js` + `lib/public-pages.js` — crawlable `/browse`, visible initial product content, and honest 404/503 responses. `/add` opens registration directly.
- `api/sitemap.js` — serves `/sitemap.xml` with every live product page. `robots.txt` points to it.
- `admin.html` + `admin.js` — the admin page at `/admin` (review, reports, placements, products, overview, settings).
- `vercel.json` — the `/p/<slug>` and `/admin` rewrites and a few security headers.
- `supabase/migrations/` — the database schema; compare migration history before deploying changes.
- `supabase/functions/verify-domain/` — the domain and GitHub checks. `supabase/functions/worker/` — background jobs
  (link checks, email, releases, embeddings). `supabase/functions/search/` — AI search.
- `fonts/` — Instrument Sans and IBM Plex Mono, subset to Latin WOFF2. `fonts/ttf/` holds the same three weights as TTF for the share-card renderer, which cannot read WOFF2, plus Noto Sans 500/700 (Latin, Greek, Cyrillic, Vietnamese; OFL, licence alongside) for names Instrument Sans cannot draw. `favicon.svg`, `og.jpg` — browser icon and the site-wide 1200×630 share image.

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

## Optional Claude assistance and portable stacks

`api/ai.js` / `lib/ai-assistant.js` use the existing server-only `ANTHROPIC_SECRET_KEY`
(`ANTHROPIC_API_KEY` also supported) for two explicit actions. Ordinary search still uses
`gte-small`, and comparison, saving and sharing require no AI calls.

- **Draft from website:** public HTTPS page → bounded text → Claude Haiku 4.5 → separate review.
  Clicking Use this draft fills empty fields; replacing existing edits is opt-in. Nothing is submitted automatically.
- **Build my stack:** goal + optional free-plan/platform filters → at most 60 relevant real catalog
  entries → up to 4 workflow picks and visible gaps. Only catalog IDs survive validation. Price,
  zone, sponsorship and popularity are not sent to the model as ranking signals.
- **Compare & save:** up to 8 tools, maker-provided facts and dated independent checks, up to
  20 browser-local stacks. `/stack#<encoded JSON>` carries only a name and product IDs. Opening
  a shared stack never auto-saves it. Missing/unpublished products are marked unavailable.

`EXPANSE_AI_TOKEN` is an independent production-only random server credential, stored only
as a SHA-256 hash in `expanse_private.ai_config`. It authenticates the quota RPC; the
publishable Supabase key cannot spend the quota by itself. Enable AI only after installing the
migration and configuring this credential. Never reuse a payment or owner credential.

The database serializes quotas across instances: 3 requests/hour per daily keyed network hash,
10/day per hash, and 100/day globally by default. Both successful and failed reserved attempts
count. No automatic retries. Each Claude call caps output at 1,600 tokens; imported text caps
at 18,000 characters and public-page responses at 512 KiB. The server fails closed if quota
storage is unavailable. Optional `ANTHROPIC_MODEL` overrides the pinned Haiku model.

Imports reject IP literals, private/reserved IPv4, credentials, non-HTTPS and nonstandard ports;
validate every redirect; pin the checked DNS address to the connection; and forward no query
parameters, cookies or auth. IPv6-only sites are not supported by the importer. JavaScript-only
or blocked pages can be filled in manually. Page content is untrusted data, not AI instructions.
The API returns no provider error bodies or credentials. It does not persist briefs, page text or
AI results in the database. Quota hashes are purged daily and during requests after two UTC days.

Local checks cover SSRF/redirects, DNS pinning, bounded structured output, catalog grounding,
fail-closed quotas, profile review, edit preservation, stale requests, safe sharing and persistence.
CI additionally runs `test/ai.sql` in the disposable database with rollback.

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
Listing is free with a 1×1 Edge spot, which is therefore never sold. Optional map placement (from €4: 2×2 on the Edge, or another zone) uses a single Stripe payment for 12 months,
including applicable tax, without automatic renewal. Payment opens after approval. Legacy founding holds remain valid. New chosen spots are held through review and for 7 days after approval; unpaid holds then return to the free Edge.
The public terms are in the "How it works" sheet in `index.html`. Search and Spotlight never use purchase state.

## The Spotlight (the core)

Nobody can pick a spot in the core. Its 8 places (a ring of 4×4 squares, `SPOT_SLOTS` in `app.js`) show the products
people actually use: live, verified domain, website answered in the last 3 days, not kept out by the admin; ranked by
popularity (below). 2 of the 8 places are kept for the best products that went live in the last 30 days, and ties
rotate every day (`md5(id || date)`), so neither size nor being early keeps a product there. While fewer than 8
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

Popularity is a share, not a volume, so a big audience or a famous name doesn't win by size: (unique clicks to the
site or demo + 2 × upvotes, each capped at the number of views) ÷ unique profile views over the last 30 days, without
the maker's own visits and votes, smoothed towards the average of all products with 20 virtual views. A new product
starts at the average instead of at zero, a few lucky clicks don't shoot a product to the top, and bought exposure
(more views) doesn't raise it. `_spotlight_refresh()` recalculates it for every live product (table `popularity`, with
`pct` 0–100 relative to the best-liked product) at most once an hour, and the Spotlight uses the same score. Public
products carry `upvotes` (live count) and `pop` (the `pct`). Search ranks by how well a product matches first and
multiplies by up to 1.35 for popularity, so a well-liked product can pass a slightly closer match but never a much
closer one. The list without a search, and "Most liked", sort by `pop`. Ties everywhere rotate every day (`dayRot`
in `app.js`) instead of going to the oldest, biggest or alphabetically first product. While the search dropdown is open, the top matches light up on the map and the best one gets a label.

## Following and updates

Visitors can follow any product (★ on the profile). The list of followed products is kept in the browser only — no account,
nothing stored about the visitor. The ★ Following button shows one combined feed from `updates`: launches, domain
verifications, profile changes (merged per day) and GitHub releases, with a count of what's new since it was last opened.

## Sharing on X

Every product page carries its own share card, so a `/p/<slug>` link posted on X, LinkedIn, Slack or iMessage
unfurls into a picture of that product rather than the generic site image.

- **Share card** — `GET /api/card?slug=<slug>&v=<version>` draws the product's name, tagline, category, upvotes,
  verification and its real position in the galaxy into a 1200×630 PNG (`lib/og-card.js`, rendered with
  `@resvg/resvg-js` using the bundled TTF fonts; system fonts are never loaded, so every runtime draws the same
  card). Only fields from `public_product` are used. `v` is a hash of the text, category, position and
  verification (not the vote count, which changes too often), so an edit gives a new URL and X fetches a fresh
  image instead of its cached one. Only the exact canonical URL of the current version is rendered: a stale `v`,
  extra or reordered parameters or an upper-case slug get an uncached 302 to it, so cache-busting URLs cannot
  force renders. The card is cached for a day at the CDN (not immutable), so the vote count refreshes and a hidden
  or removed product loses its card within a day.
- **Scripts** — a line Instrument Sans cannot draw is set in Noto Sans. Emoji and symbols no bundled font has are
  left out of the drawing. A name or tagline in any other script (CJK, Arabic, Hebrew, Indic, Thai…) gets no card,
  because the renderer silently skips missing glyphs; its page keeps the maker's first image or the site image.
- **Post on X** — the profile, the registration success screen and the Growth Studio open X's post composer
  (`x.com/intent/post`) with the text and link filled in. Nothing is posted automatically; the maker or visitor
  presses Post on X themselves. The Growth Studio button uses the campaign's tracked link and records the same
  studio event as copying the post.
- **Badge** — the owner panel's Marketing kit tab gives makers an HTML or Markdown snippet for a 230×54
  "Live on Expanse" badge (`GET /api/badge?slug=<slug>&theme=dark|light`). It shows live upvotes and links to the
  plain profile URL. It is served with a sandboxing CSP and `Cross-Origin-Resource-Policy: cross-origin`, so it
  can be embedded on any site and can never run script. Its size is fixed so a pasted snippet stays correct as votes grow.

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
| `referral_count(code)` | Legacy referral count; no unfulfilled cell reward is promoted. |
| `reserve_spot(...)`, `reserve(...)` | Founding reservations from the earlier version; kept so old links keep working. |
| `admin_*(p_key, ...)` | The admin page: overview, products, status decisions, reports, placements, settings, key rotation. Each checks the admin key. |

Functions starting with `_` are internal and not callable through the API; the edge function reaches them over the database connection.


## Product-first launch and map payments

Adding a product takes three steps: basic profile, free or chosen map placement, and review. Extended descriptions,
category, problems, audience, pricing and screenshots can be completed later. Missing pricing is shown as unspecified;
we never invent that a product is free. Live products appear as rotating entry cards on the homepage.

The **Map spot** owner tab shows the current zone, size, total and term. After approval, an owner can move to a free
spot and open a Stripe Payment Link. `owner_map_checkout` checks the owner key and approved status, locks the product,
uses the server-side catalog price, and reuses the pending order. Link quantity cannot be edited. No Stripe API key is
needed in the app: the account's Payment Links create Checkout Sessions, linked by an unguessable order UUID.

`api/stripe-webhook.js` checks the signature against the raw request body and a five-minute timestamp tolerance.
Only live events for Expanse are accepted. `confirm_map_payment` independently checks a random callback credential,
the stored order, payment link, currency, amount, zone, size and current product coordinates. Only a paid session
starts the 12-month term. The return page never grants anything. Repeated events/session notifications are idempotent;
a separate second payment or mismatch is flagged for review in **Admin → Map purchases**, keeps its Stripe session
and payment ids, and emails the admin notification address. A payment through another link, amount or square goes to
review without changing the order it names. A session that expires or fails does not end the order:
another session for the same order can still be paid. Full refunds and disputes end the paid term, also for a payment
in review; partial refunds do not automatically remove it. `expanse-map-terms` runs daily in Postgres to move
expired terms and lapsed holds to a free 1×1 Edge cell, preserving the product page and stats. It skips a spot while a
checkout for it can still be paid (48 hours after the order), never moves a product already on a free 1×1 Edge cell,
and keeps refunded and disputed states. An unpaid checkout lapses after those 48 hours and the spot can be changed again.
A rejected product keeps
its cells while its paid term runs, and a product returning from review onto taken cells moves to a free Edge cell.
Legacy holds are unaffected.
A delayed payment (e.g. SEPA) that is still processing keeps its order open and the spot protected for up to 14 days.
Holds start on the first approval or when a product moves from its free spot; moving or re-approval never extends a
running hold or revives a lapsed one, and a re-approval after an edit leaves at least a day to pay. Purchase terms are
version 2026-10-29 (`lib/legal-pages.js`, `contract_terms()`, `public_commerce()` and the checkout call in `app.js`
must change together).

See [`.env.example`](.env.example) for a credential-free configuration template. Keep real credentials in Vercel; the example file does not prove that hosting variables are configured.

Required Vercel **production** environment variables (never commit their values):

- `STRIPE_WEBHOOK_SECRET`: signing secret for this project's Stripe endpoint.
- `EXPANSE_PAYMENT_CALLBACK_TOKEN`: independent random 256-bit credential; only its SHA-256 is stored in the database.
- Optional `STRIPE_ACCOUNT_ID`: overrides the existing Nytto Labs account used by the webhook. Leave it unset to keep the current account.

The catalog, orders, webhook audit and attribution are in `expanse_private`, with table privileges revoked and RLS
on. The public API exposes only deliberate RPCs with owner/admin key checks, visitor limits or the callback credential.
`public_commerce` publishes prices and availability, never secrets or orders. Set `commerce_config.enabled` only after
configuration and deployment are verified; otherwise the UI and checkout fail closed. Preview deployments have no
production payment credentials. The account currently uses webhook API version `2026-08-26.dahlia` because Stripe limits
an account to three unique live endpoint versions; other applications' endpoints are unchanged.

**Attribution:** new profile views and outgoing clicks are recorded by source (map, search, list, shared link, Sponsored,
home). The owner sees 30-day source totals next to their existing unique counts. These do not change popularity, and
source totals are not additive unique people. Existing visits are never backfilled with an invented source.

### Verification

```sh
npm ci
npm run check
npm test
```

`test/commerce.sql` is a database transaction fixture: run it between `BEGIN` and `ROLLBACK` only. It verifies owner
access, review gating, unpaid asynchronous payments, successful activation, repeat events, duplicate checkouts,
refunds and free fallback. Do not commit test sales or fixture products. Local tests use synthetic webhook signatures;
a real customer payment is not claimed as verified until Stripe has actually processed one.

## Launch preparation

See [the launch plan](docs/launch/LAUNCH.md), [unpublished copy](docs/launch/COPY.md) and [manual measurement sheet](docs/launch/MEASUREMENT.csv). The site being deployed does not mean a marketing campaign was launched. Real payment completion, inbox delivery, Google indexing and channel conversion must not be claimed without evidence.

## Personal space and map consistency

`/me` opens **My space**: saved tools, followed products and their update feed, successful upvotes, local profile-open / outbound-click history, and the products this browser owns. Save does not vote or follow. Collections and personal activity are private to the browser, capped at 200 saves and 100 recent products; there is no account sync or public member profile. Maker statistics still use the owner-key RPCs and show other visitors separately. History can be cleared without removing owner keys or saved tools.

Map hover previews offer a 2×2 block, and clicking keeps that same size, position and euro total through registration. The chosen size is also shown in the map label. Each product uses one square (1×1, 2×2, 4×4 or 8×8); several genuinely different products from one company are allowed. Duplicate listings of one product are disallowed in review. Existing purchases are not repriced, expanded or merged by this UI change.

The intro no longer shrinks the galaxy to a dot or blocks initial controls. Zooming out is bounded relative to the whole-galaxy view. Upvote feedback uses its own `voted-pulse` class instead of accidentally applying the product panel's `.pop` layout to a button. Profile actions wrap when they need more room.

Regression coverage includes save/follow/vote separation, successful vote persistence, local click history, My space after reload, saved-item removal, and preserving the map preview's 2×2 €76 Inner-ring quote when entering registration.


## Purchase and privacy operations

English `/terms`, `/privacy`, `/seller` and `/withdraw` pages are served by
`api/legal.js`. Seller details are configured in `/admin#settings` and are public
only after explicit publication. Checkout availability is controlled separately by
`commerce_config.enabled`; personal-data publication is not a technical checkout prerequisite.
No personal identity number is seeded from tax documents. Accepted terms and receipt
reply addresses use only explicitly published seller data, never private drafts.
Unpublished seller registration/address remains a legal-information gap; the attribution
“by NyttoLabs” is not a statement that all seller-disclosure requirements are satisfied.

Withdrawal notices do not require login. A recorded notice returns a downloadable
acknowledgement and queues email; admin review never automatically issues a payout.
The owner panel keeps order details and accepted purchase-term snapshots.

GitHub Actions runs `npm run check`, `npm test` and fresh local Supabase
`npm run test:db` on push/pull request. DB fixtures always roll back, cannot use
production credentials and disable outgoing worker calls in the test transaction.
Function JWT settings are versioned in `supabase/config.toml`; custom owner and
worker-secret checks remain required.

Daily database retention and manual mailbox responsibilities, refund handling and
remaining launch verification are documented in [OPERATIONS.md](docs/launch/OPERATIONS.md).
A real checkout/refund test was explicitly excluded by the user on 2026-10-20.
Passing synthetic tests is not verification of a real payment or inbox delivery.
