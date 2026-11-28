# Project status

Updated November 27, 2026. Deployed to
[photospots.luisisthejuarez.workers.dev](https://photospots.luisisthejuarez.workers.dev)
with Workers, migrated D1, private R2, Better Auth and Resend email links. Google sign-in is
disabled until OAuth credentials are configured. Development fixtures were not copied to production.

Source was published through the connected GitHub account because this session cannot write the
local Git metadata. The original checkout's files remain available, but its Git status may still
show the published changes until the checkout is synchronized locally.

Verification: 350 tests passing (288 unit, 62 integration), TypeScript checks, production build,
and native workerd HTTP smoke. Production dependency audit reports zero known vulnerabilities.
Independent review findings were addressed with regression coverage and cutover documentation.
Live checks confirmed the homepage, sign-in page, session API, private media behavior, and map
worker/tile loading. The maintenance cron is enabled. Real email delivery remains a user-initiated
sign-in check; no test email was sent automatically.

## Main user journey

The interface now prioritizes photographers finding a shoot location: browse photos alongside
the map, open a location, check practical details, and get directions. Search, shoot type and
one Filters control replace the wall of controls. Advanced filters and community actions expand
when needed. Phones have explicit photo/map controls; return links preserve search, filters,
viewport and the mobile pane.

Adding a location starts with a centered map pin. Sign-in preserves that pin and returns to the
submission form. Photo uploads show previews, credits and rights confirmation; practical details
stay optional. Local browser checks use mocked email delivery and development images only.

## Implemented

- Worker SSR/cron, active SQLite migrations and generated binding types.
- Prepared reads, filters, proximity, actor-scoped writes and transactional contribution batches.
- Better Auth sessions, persistent rate limiting, origin checks and optional Google/email providers.
- Authenticated R2 uploads, ownership/expiry receipts, moderated reads and abandoned-upload cleanup.
- Local migrations, idempotent fixtures, ranking tools and a stable-ID legacy export/import bridge.
- Unit/integration tests and an isolated production-bundle HTTP smoke in workerd.

Existing map views, contributions, votes, comments, attributes, rights/caps, studio claims and
moderation remain. Historical Postgres migrations and tests are under `supabase/`.

## Before launch

Follow [CLOUDFLARE.md](CLOUDFLARE.md) for the deployed resource IDs and redeployment commands.
Complete a real email sign-in and add real credited photography locations. Configure Google only
after registering its callback and supplying credentials. Any later legacy import needs rehearsal
and a separate fresh target; importing database rows does not copy stored images.

## Product limits

Viewport queries cap at 500 matches. Editing existing spots does not replace photos. Hourly
maintenance targets the current small dataset; higher volume may need queues. MapLibre is the
largest browser chunk. Passwords, passkeys, MFA, threaded comments, notifications and saved lists
are outside this refactor's scope.

See [engineering notes](ENGINEERING-NOTES.md) and
[the implementation plan](superpowers/plans/2026-11-25-cloudflare-better-auth.md).
