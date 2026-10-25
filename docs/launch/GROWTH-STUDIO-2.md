# Growth Studio 2.0 — release contract

25 October 2026. Extends Expanse main 99733ba. No payment, entitlement or organic-ranking schema changes. Minimum paid map order remains EUR 3; Edge 2×2 remains EUR 4.

## Discovery

Search uses existing lexical/semantic need matching and approved public products. Weak lexical overlap (<35%, without a strong semantic match or exact product name) is excluded. Result labels describe profile overlap, never guaranteed suitability. Search relevance is not replaced by the default browse popularity sort. Existing newcomer Spotlight allocation and daily tie rotation remain unchanged. Result cards provide problem, audience, pricing where known, ownership verification, website, save and comparison controls. Low inventory has specific query ideas and an optional saved need. Demo inventory stays separate.

## Private Growth Studio

The existing `owner_acquisition_stats(slug,key)` contract retains totals/sources/campaigns and adds 7/30-day current/previous windows, daily series, named campaign rows, coverage and completed actions. All private reads/mutations use `_owned`; no owner keys in campaign URLs or public cards. Daily unique counts are not lifetime unique people. Sources/campaigns overlap and are not additive. Map impressions, local saves/follows, third-party conversions and revenue remain unknown (JSON null / not connected). Source/channel/campaign tables are explicitly 30 days. Comparisons crossing collection start or listing approval are partial. No 90-day UI claim.

Readiness checks public profile completeness, working link, valid action, ownership and kit, never popularity/payment. Recommendations are deterministic and at most three: card opens under 5% after 100 impressions; website clickers under 10% after 30 profile opens; matched campaign continuation under 10% after 30 campaign opens. Missing data is not zero. Completion retains an aggregate 7-day baseline and subsequent complete UTC days (up to 30), not causal improvement or statistical significance.

## Marketing and campaign contract

Existing `marketing_kits`, `marketing_campaigns`, `campaign_events`, `exposure_events`, legacy IDs and public original SVG endpoint are preserved. Named campaigns add private name/kind columns. IDs remain server-generated `mk-` plus 12 hex characters; tracking validates product/campaign ownership and channel. Threads joins the existing allowlist. Creation reuses identical names/kinds, capped at 50 per product and 10/hour; old generated profile campaigns are preserved too.

Portrait, square and story SVG/PNG assets use approved public facts only. Copy styles cover X, Threads, LinkedIn, newsletter and announcements; launch, factual feature focus, comparison and seasonal purposes are available. Seasonal templates claim no discount. Browser PNG cache reuses exact template revision/format. No automatic posts or emails.

## Need updates pilot

Uses existing `submit_tool_need`, `tool_need_status`, matching and private management receipts. Optional in-app update checkbox is unchecked by default. Returning to My space → Needs checks real approved matches and marks newly matching slugs; no background/email delivery is promised. Existing 200-active cap, rate limits, anonymization review, no contacts, 90-day expiry and withdrawal stay intact. Clearing browser receipts removes local update preferences. Export/import receipts remains available.

## MakeItReal handoff

Destination verified in the MakeItReal repo: https://makeit-real.vercel.app/en/launch.html. Expanse rechecks ownership through its kit/stat requests, displays an allowlisted public-facts JSON brief, lets the maker copy it, and opens Campaign Studio. The maker pastes and confirms there. Tracking profile URL is included; return URL is Expanse home, where My product → Growth Studio resumes. No OAuth, query-based automatic import, account linkage, private analytics or third-party conversion connection is claimed. Never add owner keys or session tokens to this contract.

## Seasonal offers

One submission per approved, domain-verified product. Offer/evidence URLs must use that verified domain. Title, detailed terms, supporting evidence/price-history note and start/end timestamps are required, max duration 90 days. An admin explicitly reviews real evidence and applicable prior-price disclosure before approving. Edits reset approval. Public RPC filters approval, ownership, product status and server time on every request; expired offers disappear without waiting for cron. Review is not legal certification. Private evidence notes are never returned publicly. Old offers are removed 90 days after expiry. No paid organic priority or fabricated countdowns.

## Business measurement

Admin-only metrics: approved products, median submission-to-approval time, distinct products opening/returning to the studio, kit use/copy/PNG download, real campaign arrivals, outbound clicks and existing Stripe-webhook-confirmed gross map payments. A successful copy is not verified publication. Unique maker identity is not reliably available and remains null. Gross payments are not net revenue; fees, refunds, disputes and tax are not deducted. Adoption deduplicates product/action/UTC day and retains 90 days.

## Verification and rollout

One feature branch. Applied migration files remain byte-for-byte unchanged. The additive migration is CLI-generated. GitHub Actions replays all SQL and runs transactional fixtures with cron disabled and mail worker stubbed; production is never reset. Merge only after application/database checks pass, then existing Supabase GitHub integration applies the same filename/version. Verify production history, new grants and EUR catalog after deploy. No test purchases/refunds or fictional public listings.

Limitations to report honestly: no real phone/device visual pass if browser viewport emulation is unavailable; no live private owner session or native PNG download without authorized login. DOM interaction and pure renderer checks do not replace those checks. External payment conversion and automatic MakeItReal import are intentionally unconnected.
