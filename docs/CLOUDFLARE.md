# Cloudflare deployment and Supabase cutover

The active stack is React Router 8.5, Workers, D1 (`DB`), private R2 (`PHOTOS`), Better Auth,
and Resend. `cloudflare.config.ts` is the deployment source. Use project-local `cf` via npm/npx.
Tests, seeds, backfills and local imports never provision or deploy production resources.

## Local configuration

Follow the README. `.env` supplies public build configuration; `.dev.vars` supplies local Worker
secrets. `AUTH_ORIGIN` must exactly match the browser origin, including its port. HTTP is accepted
only on localhost. The pinned runtime supports compatibility date `2026-11-24` and `nodejs_compat`.
Upgrade the CLI, Vite plugin, Miniflare and compatibility date together and run the runtime test.

Migration, seed and Vite use the same D1 UUID and `.cloudflare/state/v3` directory. Changing
`D1_DATABASE_ID` selects a different local database even if its name is unchanged. Scripts use
`node --import tsx` to avoid an unnecessary IPC listener. In managed environments where global
registry writes or filesystem watchers are restricted, use writable state and polling:

```bash
export CLOUDFLARE_DEV_REGISTRY_PATH=/tmp/photospots-dev-registry
export CHOKIDAR_USEPOLLING=1
```

These are local tooling settings, not production bindings.

## Authentication

Better Auth stores users, accounts, sessions, hashed magic-link tokens and rate-limit records in
D1. Sessions last seven days and refresh after one day. Explicit CSRF/origin checks are enabled;
request context verifies the session and reads the current role from `profiles`.

For **Google**, create an OAuth Web application client. Set its JavaScript origin to `AUTH_ORIGIN`
and authorized redirect URI to `https://YOUR_PUBLIC_HOST/api/auth/callback/google`. For local
testing also allow `http://localhost:5173` and `http://localhost:5173/api/auth/callback/google`.
Configure both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in secrets. No Supabase callback is used.

For **magic links**, set secret `RESEND_API_KEY` and public `AUTH_EMAIL_FROM` on a verified Resend
domain. Links expire in ten minutes, are stored hashed, and redeem once. Email uses Resend's HTTP
API. The UI offers only configured providers; public browsing works without either provider.

Runtime tests capture delivery instead of sending mail. Real Google consent and Resend deliverability
still need testing with your provider accounts before launch.

## Production setup

### Current deployment

Provisioned and deployed November 25, 2026:

| Setting         | Value                                                 |
| --------------- | ----------------------------------------------------- |
| Public origin   | `https://photospots.luisisthejuarez.workers.dev`      |
| Worker          | `photospots`                                          |
| D1 database     | `photospots` / `8705add4-21b4-425c-b751-60542fa6e7c6` |
| R2 bucket       | `photospots-photos`, private; public domain disabled  |
| Email sender    | `Photospots <photos@iamluisj.com>`                    |
| Map style       | `https://tiles.openfreemap.org/styles/liberty`        |
| Maintenance     | `17 * * * *`                                          |
| Deployed source | Git commit `ce57f6f850a46c37c9244b405801a8c1dd3741ed` |

The database has all three migrations, with the standard `d1_migrations` bookkeeping table.
Development fixtures were not copied. Email uses a domain-restricted Resend sending key;
Google is disabled until both OAuth credentials are supplied. Live inbox delivery has not been
triggered automatically. The map's module worker is emitted by Vite and serves successfully.

For redeployment, reuse the existing resources and stable authentication secret. The current
checkout has an owner-only `photospots.secrets.json` file, explicitly ignored by Git. Do not commit
or regenerate it on every release. A fresh checkout needs the existing credentials supplied securely.

```bash
npx cf auth login
export D1_DATABASE_ID='8705add4-21b4-425c-b751-60542fa6e7c6'
export AUTH_ORIGIN='https://photospots.luisisthejuarez.workers.dev'
export PHOTOS_BUCKET_NAME='photospots-photos'
export AUTH_EMAIL_FROM='Photospots <photos@iamluisj.com>'
export MAP_STYLE_URL='https://tiles.openfreemap.org/styles/liberty'
npm run check:deploy
npm run deploy -- --secrets-file photospots.secrets.json
```

The first deployment used the connected Cloudflare API because the local CLI had no active
login. CLI login is required for the redeployment command above. The setup steps below are for
new environments; skip resource creation when deploying updates to the existing environment.

### New environments

Choose the final custom-domain or `workers.dev` origin before configuring callbacks.

```bash
npx cf auth login
npx cf d1 create --name photospots
npx cf r2 buckets create --name photospots-photos
```

Use the returned D1 UUID. Keep R2 private: do not enable `r2.dev` or a public bucket domain, since
all reads must pass through the Worker's moderation check.

```bash
export D1_DATABASE_ID='REPLACE_WITH_REAL_DATABASE_UUID'
export AUTH_ORIGIN='https://YOUR_PUBLIC_HOST'
export PHOTOS_BUCKET_NAME='photospots-photos'
export AUTH_EMAIL_FROM='Photospots <photos@YOUR_VERIFIED_DOMAIN>'
npx cf d1 migrations apply "$D1_DATABASE_ID" --dir migrations
```

Omitting `--local` explicitly selects the remote database. Back up existing targets first. Complete
any existing-data cutover before enabling sign-in. Do not use the local SVG seed for launch content.

Create a JSON secrets file outside the repository. Generate a fresh random production secret;
fill credentials for providers you enable and leave other provider values empty:

```json
{
  "BETTER_AUTH_SECRET": "REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS",
  "GOOGLE_CLIENT_ID": "",
  "GOOGLE_CLIENT_SECRET": "",
  "RESEND_API_KEY": ""
}
```

```bash
npm test
npm run typecheck
npm run test:runtime
npm run check:deploy
npm run deploy -- --secrets-file /path/outside/repository/photospots-secrets.json
```

`predeploy` rejects the local D1 UUID and non-public/non-HTTPS origin. Deployment builds fresh
output, uploads secrets and binds resources. Keep the production auth secret stable across
releases. Cron runs maintenance at minute 17 each hour. Observability and sampled traces are
enabled; query strings are redacted to keep sign-in links out of request logs.

After deployment verify public pages/media, enabled sign-in methods, logout, contribution, a studio
claim and moderation. Check the first `scheduled_maintenance` log. Select production map tiles.

## Existing Supabase data

Historical migrations/tests remain under `supabase/`; there is no Supabase runtime dependency.
User IDs remain profile/contribution/ownership/report keys. Google identities retain their provider
`sub`. Email users use new magic links. Passwords, OAuth tokens and sessions are not copied;
everyone signs in again after cutover.

1. Back up database and storage. Rehearse in staging. Stop legacy writes for the final export/copy
   so new contributions cannot be missed.
2. Create a private temporary directory before producing the snapshot. It contains account email
   addresses, roles and moderation records; keep the directory private through review and transfer:

   ```bash
   umask 077
   photospots_migration_dir="$(mktemp -d "${TMPDIR:-/tmp}/photospots-cutover.XXXXXX")"
   psql "$LEGACY_DATABASE_URL" -XAt -f scripts/export-supabase.sql > "$photospots_migration_dir/snapshot.json"
   ```

3. Apply D1 migrations to an empty target. Do not seed it or enable sign-in first. A local rehearsal
   uses `npm run import:legacy -- "$photospots_migration_dir/snapshot.json"`. To prepare a reviewed batch without
   modifying any database:

   ```bash
   npm run import:legacy -- "$photospots_migration_dir/snapshot.json" --batch-file "$photospots_migration_dir/import.json"
   ```

4. Review the parameterized commands, select the intended fresh staging/production UUID, then apply:

   ```bash
   npx cf d1 query "$D1_DATABASE_ID" --batch "@$photospots_migration_dir/import.json"
   ```

   The batch includes an empty-target guard. It preserves IDs, roles, timestamps, moderation,
   nullable attributes, attribution and Google subjects. Triggers rebuild contribution counts.
   The importer is intended for the small MVP snapshot; large datasets need staged migration and
   reconciliation rather than one in-memory batch.

5. Copy legacy `spot-photos` objects into private R2 using an S3-compatible transfer tool, preserving
   **every storage key and Content-Type**. Files are not in the JSON snapshot. Compare object counts
   and representative bytes; verify scouting/session images and credits. Keep moderated objects
   private for rollback; the Worker refuses to serve them.
6. Compare row counts, authors, roles, galleries, studio ownership and reports. Test imported Google
   and email accounts in staging. Refresh rankings through scheduled maintenance, verify public
   output, then switch traffic.
7. Retire the legacy public media access before accepting the cutover. The original bucket is
   public **and** its `spot photos are publicly readable` SELECT policy allows anonymous object
   reads. A private R2 bucket cannot protect the old URLs. After copying/verifying private backups,
   apply this reviewed change to the legacy database, or fully retire the old storage service:

   ```sql
   BEGIN;
   UPDATE storage.buckets SET public = false WHERE id = 'spot-photos';
   DROP POLICY IF EXISTS "spot photos are publicly readable" ON storage.objects;
   COMMIT;
   ```

   Check for other policies granting anonymous reads to that bucket. Purge/invalidate legacy CDN
   objects, or retire the legacy bucket after its private backup; account for existing cache TTLs.
   Verify denial with an **actual historical public URL**, both its previously cached exact URL and
   a cache-busted request. Also verify that the old anonymous storage API cannot read the object.
   Require 403/404 before signoff. Previously downloaded browser copies cannot be recalled.
   Disable legacy contribution/auth endpoints so stale clients cannot continue writing there.

Retain legacy rollback copies privately until reconciliation is accepted; do not retain a public
media bypass. Remove the private migration files when no longer needed. If rolling traffic back after
new D1 writes, export and reconcile them first: the initial snapshot is not reverse synchronization.

## Maintenance

Uploads require a session, valid image signature/type and at most 8 MB of actual request bytes.
Unattached receipts expire after 24 hours, with at most 36 staged uploads per user. Only a ready,
unexpired receipt belonging to the session actor can attach. Spot, types, photos and receipt updates
commit together. Cleanup claims expired receipts before deleting R2 objects and removes receipts
only after success; failures leave retryable state. Each run handles at most 100 abandoned objects.

Media responses revalidate publication even with an ETag. Lifetime scores use shared TypeScript
weights with compare-and-swap against counters. Hot scores page recent events, apply the shared
14-day half-life, round once and reset quiet spots. Hourly maintenance repairs lifetime scores,
then hot scores and abandoned uploads. Larger datasets may require Queues instead of one cron.
