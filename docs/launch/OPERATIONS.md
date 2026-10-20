# Release and operating notes — 2026-10-20

The user explicitly excluded a real purchase/refund test. Unit/DOM/database
fixtures are not evidence of a completed Stripe payment or inbox delivery.

## Seller publication

On 20 October the proprietor requested seller details in the footer, Terms and Privacy. Use the verified registration document and existing Stripe public support profile for those fields. Do not commit personal identifiers or addresses to source files. The database public seller settings are the single source of truth.

To update authorized details, open `/admin#settings` and enter legal name, registration number, postal and
complaints address, support email and phone. Publish only after the proprietor
explicitly authorizes the public fields. A Swedish sole trader's registration
number may be their personal identity number. Uploaded tax documents are not
automatically published or seeded into public settings.

`public_commerce.enabled` and the checkout RPC require complete published seller
details. The existing Stripe links and webhook remain configured. Existing free
listings and withdrawal notices continue to work while new checkout is gated.

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
