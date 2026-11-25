# Historical Supabase tests

These describe original Postgres/PostGIS, RLS, RPC and storage behavior. They are migration
reference and are not compiled/run by the D1 application. Their dependency/path assumptions
belong to the pre-migration Git revision. Current tests are in `app`, `tests/d1`, and the
`npm run test:runtime` production-bundle smoke. Do not reinstall Supabase SDKs for the current app.
