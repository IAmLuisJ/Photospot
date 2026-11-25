# Project status

Updated November 25, 2026. Refactored for Cloudflare Workers, D1, R2, Better Auth Google sign-in
and Resend magic links. Changes are in the existing checkout. No production provisioning, import,
provider setup or deployment has been performed.

Verification: 333 tests passing (275 unit, 58 integration), TypeScript checks, production build,
and native workerd HTTP smoke. Production dependency audit reports zero known vulnerabilities.
Independent review findings were addressed with regression coverage and cutover documentation.

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

Follow [CLOUDFLARE.md](CLOUDFLARE.md): choose an origin; create D1/R2; configure a stable auth
secret, enabled providers, callbacks and verified sender; migrate/rehearse existing data and
photo objects; deploy; test real provider flows. Configure production tiles and real credited photos.
Legacy sessions need a new sign-in. Importing database rows does not copy stored images.

## Product limits

Viewport queries cap at 500 matches. Editing existing spots does not replace photos. Hourly
maintenance targets the current small dataset; higher volume may need queues. MapLibre is the
largest browser chunk. Passwords, passkeys, MFA, threaded comments, notifications and saved lists
are outside this refactor's scope.

See [engineering notes](ENGINEERING-NOTES.md) and
[the implementation plan](superpowers/plans/2026-11-25-cloudflare-better-auth.md).
