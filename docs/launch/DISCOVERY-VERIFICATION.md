# Maker discovery verification · 21 October 2026

Story: a maker lists a real product for free, receives a reusable sharing kit when approved,
and measures discovery through to website clicks. A visitor can find tools or voluntarily
save an unmet need; sharing requires separate consent and an anonymization review.

## Verified

- PR #29 restored four original production migration versions. The Supabase check on main
  passed without a production reset or history repair.
- PR #30 passed 39 application tests, DOM flow tests and 72 transactional SQL assertions.
  All migrations replayed in the disposable CI database. Those fixtures were rolled back.
- Production deployment `cecfda9d16087aac694951e3a393b9527baed719` reached READY at the custom
  domain. Supabase applied `20261021185448` and `20261021190346` with exactly the repository
  versions. Read-only comparison confirmed all 50 SQL statements, ignoring separator blank lines.
  Their source hashes are now included in migration-history.json.
- The homepage renders the maker offer and preserves Find tools, Browse products and the
  existing AI stack builder. A live AI request for “Fix a failing deployment” returned
  DeployDoctor with a fit explanation and explicit gaps, based on one real public product.
- A prepared DeployDoctor marketing image exists in production and its public endpoint
  returned HTTP 200, image/svg+xml and the matching revision ETag. Browser inspection found
  stretched title lettering; the follow-up migration fixes short titles and refreshes the kit.
- /needs loads a real empty board. The form has no contact field and its separate sharing
  checkbox is unchecked. Production contained zero submitted needs; no fake requests were added.
- Isolated owner fixtures verify prepared-kit reuse, editable draft persistence, tracking link
  channels, fallback on kit failure, real zero metrics and disconnected external purchases.
- Frontend and SQL fixtures verify campaign capture before URL cleanup, outbound campaign
  preservation, generated-ID validation, daily deduplication, visibility dwell, owner exclusion,
  consent, moderation, opt-in matching, receipt authorization, withdrawal, limits and retention.
- Known AI quota/provider failures preserve manual workflows and do not publish profiles.
- Supabase security advisories show the project's intended API model: private tables have RLS
  without direct policies/grants; exposed SECURITY DEFINER RPCs perform owner/admin/receipt
  checks. Transactional tests cover unauthorized access. Review guidance:
  https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- The new campaign composite foreign-key index is added in the follow-up polish migration.
  Pre-existing Stripe foreign-key indexing advice is outside this discovery change. Guidance:
  https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- No application errors appeared in the inspected production runtime window. Browser console
  errors were from the automation extension, not the app.

## Practical limits

- Mobile/coarse-pointer interaction paths run in DOM tests. The available cloud browser has a
  desktop viewport and no resize/device API; a visual pass on a real iPhone/Android remains.
- Owner-authorized flows and needs publication/withdrawal are tested with disposable fixtures,
  not by taking over a real maker's owner key or adding fabricated production demand.
- PNG conversion uses the browser canvas and a bounded IndexedDB cache, with the original SVG
  as fallback. The live original image is verified; native PNG download still needs an owner
  session check in a normal browser.
- No purchase/refund was executed. Product-sales verification is not connected; clicks are
  not sales. Map impressions are not measured. The needs pilot matches English profile terms
  conservatively and can miss synonyms; it does not assess buying intent or guarantee fit.
- One live product and zero shared needs are honest starting values. Traffic and demand must
  come from real visitors and makers, not seeded metrics or invitations with special treatment.
