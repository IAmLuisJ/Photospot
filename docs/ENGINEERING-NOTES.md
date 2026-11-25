# Engineering notes

## Authorization

D1 has no Supabase RLS. Every command takes a server-verified `DataContext`; check its actor in
the SQL mutation, not just a loader. Direct POSTs bypass loaders. Profile role, status, counters
and scores are not client-editable fields. Moderation reads the current database role.

Zero affected rows means a conditional edit or claim failed. Never show success just because
SQL did not throw. Studio ownership records change in one batch; report resolution changes the
target and closes the report together.
Report resolution also checks the affected-row count and returns a conflict if another moderator
has already acted; a losing remove must not claim success after a winning dismissal.

## SQLite

Use partial unique indexes for the two vote shapes: ordinary nullable UNIQUE keys allow repeated
shoot-again votes. JSON attributes are TEXT with shape/vocabulary checks. Null means unknown;
an empty array means none apply. Zero walk time and false dog-friendly are real values. Filter
before LIMIT. Geographic bounds select candidates; shared Haversine determines duplicate distance.
Optional checkbox groups include an explicit unknown/known control. Known with no checked values
means an empty array; missing groups preserve existing values on edits.

Deletion nulls authored-content/ownership references and cascades ballots/sessions. Keep six
published photos per kind and session-photo rights enforced in both the schema and domain layer.
Application timestamps are UTC ISO text; Better Auth controls its adapter timestamps. Import
normalizes source timestamps before ranking's lexical range comparisons.

## Uploads

The server creates keys. Form JSON proves neither existence nor ownership: photo attachment
requires a ready receipt, actor ID and database-time expiry inside the batch. Cleanup claims a
receipt first, preventing expired objects from racing attachment. Buffering is bounded at 8 MB.
R2 receives known-length bytes: a generic Blob stream can fail in workerd. Check actual size and
signature rather than trusting headers. Keep R2 private and check publication before a 304.

## Auth and routes

Preserve response cookies on every path, including redirects. Keep separate Set-Cookie headers;
do not join them with commas. Use React Router `data(value, { headers })` for typed loader data.
Better Auth origin/CSRF checks stay explicitly enabled in tests. App actions require the configured
same origin; OAuth callbacks and magic-link redemption remain public GET endpoints.

Validate form JSON before domain functions consume typed input. A TypeScript cast cannot validate
null, invalid JSON or a string rights attestation.

## Verification

Pinned React Router 8.5.3 and Cloudflare CLI/plugin rc.5 agree on build output paths; earlier versions
did not. Build and exercise the Worker, not only the browser assets. Run type generation before
building because it can clear Cloudflare output.

`npm test` uses real SQLite constraints/transactions behind a D1 interface and actual Better Auth
handlers with captured delivery. `npm run test:runtime` separately uses the production bundle and
native D1/R2 over HTTP in workerd. No Supabase/Docker service is required.

Historical Postgres/RLS lessons remain in [the archive](archive/supabase-engineering-notes.md).
