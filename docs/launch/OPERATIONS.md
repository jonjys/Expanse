# Release and operating notes — 2026-10-20

The user explicitly excluded a real purchase/refund test. Unit/DOM/database
fixtures are not evidence of a completed Stripe payment or inbox delivery.

## Seller publication

The proprietor requested a compact “by NyttoLabs” attribution in the main footer. Do not show a company-details panel there. Seller fields remain unpublished following the explicit refusal to publish personal identifiers and address; payment availability is controlled separately by commerce_config.enabled. Legal pages retain the seller block, ready for any later explicitly authorized publication.

To update authorized details, open `/admin#settings` and enter legal name, registration number, postal and
complaints address, support email and phone. Publish only after the proprietor
explicitly authorizes the public fields. A Swedish sole trader's registration
number may be their personal identity number. Uploaded tax documents are not
automatically published or seeded into public settings.

`public_commerce.enabled` and the checkout RPC respect `commerce_config.enabled`.
They do not make seller publication a technical prerequisite. Owner keys, product
approval, accepted terms, catalog prices, the pause switch and signed payment
confirmation remain enforced. The existing Stripe links and webhook remain configured.
Contracts and receipt reply addresses read published seller data only.

Seller registration/address are still unpublished. Removing the application gate
is not legal clearance or proof of a real purchase. Complete the seller disclosure
separately using only details the proprietor explicitly authorizes.

## Withdrawal notices

`/withdraw` is available without an account or owner key. The visitor reviews
details, confirms withdrawal and receives a timestamped downloadable notice.
The transaction records the request and queues acknowledgement/admin emails.
Retrying the same notice from the same daily visitor identity does not create
another notice/email within 24 hours. No refund is authorized by form input.

Review `/admin#withdrawals`, verify the original payer/payment and date in Stripe,
process a qualifying refund there, reply to the customer and record the action.
"Mark handled" only records resolution. It never moves money. Monitor outbox
failures. Provider acceptance is not proof of delivery into the inbox.

## Retention

Daily cron `expanse-retention` enforces the periods in `/privacy`: 7-day contact
and sign-in rate logs, expired codes after 1 day, 90-day events/owner marks,
sent/failed email copies and resolved reports. Unresolved report details clear
after 365 days. Withdrawn votes and revoked keys clear after 90 days. Resolved
withdrawals clear after 2 years. Accounting records remain through the seventh
year after purchase. Open notices, active votes and unsent mail are retained.
Support-mailbox cleanup is a manual review within 12 months after resolution;
application cleanup does not delete provider logs, mailbox copies or backups.

## Verification

`npm ci --ignore-scripts`, `npm run check`, `npm test` cover server pages,
withdrawal UI, admin denial/escaping/manual resolution, all three Edge Function
request handlers, webhook validation and the original product/registration flows.

`npm run test:db` is intentionally fixed to local Docker container `supabase_db_expanse` and wraps
all fixtures in BEGIN/ROLLBACK. Its transaction replaces `_kick_worker` with a
no-op and disables cron, so tests do not send real messages. CI builds a fresh
local Supabase stack and replays every migration before running commerce and
withdrawal/retention assertions. No production DB secrets are used in CI.

## Marketing

`COPY.md` contains unpublished launch drafts and `LAUNCH.md` the channel plan.
No campaigns, invitations or posts are sent by this release. Campaign URLs
remain labels rather than a verified channel-conversion integration. One live
listing does not establish market demand or guarantee maker revenue.

## Legal sources reviewed

- https://www.konsumentverket.se/nyhet/lagandring-gor-det-enklare-att-angra-kop-pa-natet/
- https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-200559-om-distansavtal-och-avtal-utanfor_sfs-2005-59/
- https://www.imy.se/verksamhet/dataskydd/dataskydd-pa-olika-omraden/foretag/

The voluntary full refund within 14 days applies to business purchasers too.
It avoids deductions for an immediately started placement. It is a product
policy, not a claim that all business purchases have statutory withdrawal rights.

## Keyboard access

Information and product-action dialogs have accessible titles, keep Tab and Shift+Tab inside the active dialog, and restore focus on Escape or close. Replacing dialog content preserves its opener. Global search shortcuts do not steal focus from an open dialog. DOM regression checks cover these interactions.

## Claude assistance

Production uses the existing ANTHROPIC_SECRET_KEY and an independent EXPANSE_AI_TOKEN.
Quota defaults: 3 requests/hour per daily network hash, 10/day, 100/day globally; 1,600 output
tokens per generation. Failed reserved attempts count. No automatic retries or background AI.
Pause AI with `update expanse_private.ai_config set enabled=false where singleton;` in the
authorized database console. This does not affect registration, search, payments or stacks.
Monitor aggregate counters without selecting visitor hashes. Retention job: expanse-ai-retention.
Never expose or rotate the payment callback credential as part of AI operations.

## Migration history

The migration filename version must match `supabase_migrations.schema_migrations`,
including changes applied through MCP. After applying a migration, read its actual recorded
version and statements, restore that exact filename/SQL in the repository, and refresh
`supabase/migration-history.json` from read-only history before merging. Do not repair or reset
the production history to match a locally generated timestamp. Supabase Preview checks this
history separately from our application and disposable-database tests.

The history regression test checks recorded names, versions and SQL hashes. The only existing
replay exception is 20261013220355: production had an unrecorded temporary `probe_headers()`
debugging helper. The repository conditionally revokes it so fresh databases can replay the
migration. The test reconstructs and hashes the original final statement, allowing only that
specific guard; it never creates the debugging endpoint or changes production privileges.

## Maker discovery release

Deploy SQL through the existing Supabase GitHub production integration, preserving the
CLI-generated filename version. Run the disposable database workflow before merging. After
main is applied, verify Supabase Preview and compare the two recorded versions with the repo;
refresh the read-only history snapshot. Do not apply the same SQL through MCP with a new version.

The Sharing kit owner tab reads a prepared kit. Publication and public profile edits refresh
its version; private contact edits and traffic do not. Older campaign IDs continue to work.
Makers choose a channel and copy their own post; nothing publishes to a social account.
PNG conversion is local and cached (20 images); the original SVG is available if conversion fails.

Stats show daily deduplicated card impressions, profile opens and outbound website clicks.
Search, list and home cards require 60% visibility for a second in an active tab. The map canvas
is not instrumented for impressions. Campaign parameters are restricted to generated IDs and
four channels; no arbitrary referrer or contact data is recorded. Verified product purchases
are not connected. Do not infer them from outbound clicks or Expanse placement payments.
Acquisition events expire after 90 days via expanse-acquisition-retention.

## Needs pilot

Visitor entry: an empty search, /needs, or My space → Needs. At most 200 active requests;
three per UTC visitor hash per hour and five per day. Private receipts allow checking matches
and withdrawing without collecting an email. Download the receipt for use on another device.
Browser storage is not a synchronized account. Submitted needs are not sent to Anthropic.

Sharing consent is optional and unchecked. Consented submissions remain private until reviewed
in /admin#needs. Remove identifying names, contacts and confidential details, edit the public
version, then explicitly acknowledge anonymization before publishing. Do not seed demonstration
requests in production. Declining keeps a request private; withdrawing clears shared text at once.

Makers opt in from their Needs pilot tab (off by default). Delivery is in that panel only;
no emails, outreach or contact-sharing. Matching uses at least two shared meaningful English
terms and 35% query coverage in real approved profiles, with the exact overlapping terms and
profile tagline shown. It is a conservative lexical pilot, not an assessment of capability or
purchase intent; map payments and votes do not affect it. Needs expire after 90 days, rate
hashes after seven, and withdrawn records within seven days via expanse-needs-retention.

## Map payment lifecycle release (2026-10-29)

Three migrations ship together and are applied by the Supabase GitHub production integration when the branch is merged
to main: `20261028222833_map_payment_lifecycle`, `20261028223424_marketing_kit_text_fit` and
`20261029175620_map_terms_2026_10_29`. After main is applied, read the recorded versions from
`supabase_migrations.schema_migrations`, keep the filenames identical, and refresh `supabase/migration-history.json`
from read-only history. The frontend sends terms version 2026-10-29, so deploy the site and the migrations together;
every payment attempt from a page opened before the release fails until that page is reloaded. Such a page shows the
generic "Could not start payment … try again" message, so support should tell owners to reload. Pages from this release
show a reload message at the next terms change.

Payments in review now email the admin notification address (Admin → Settings). Set it before enabling checkout.
Vercel logs show `stripe_webhook_confirmation_failed` when Stripe will retry an event and
`stripe_webhook_ignored_paid_session` when a paid session lacked Expanse metadata; both carry Stripe ids only.
