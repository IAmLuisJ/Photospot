# Cloudflare and Better Auth Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user has authorized implementation in the existing workspace.

**Goal:** Run Photospots on Workers with D1, R2, Better Auth Google login, and Resend magic links, preserving existing product behavior.

**Architecture:** Keep React Router SSR, domain functions, and component props. Pass a verified viewer and D1 binding into server repositories; authorize every write there. Use atomic SQL batches and SQLite constraints/triggers for contribution integrity. Serve R2 photos through the Worker so moderation also applies to media requests.

**Tech Stack:** React Router 8.5.3, Cloudflare Vite plugin rc.5, cf CLI rc.5, D1, R2, Better Auth 1.7.28, Resend HTTP API, Vitest and Miniflare.

**Spec:** Existing `docs/superpowers/specs/2026-08-09-photospots-design.md`, the migration review in this conversation, and the user's instruction to implement the refactor with Better Auth.

## Global Constraints

- Preserve scoring weights, the 200-meter duplicate radius, six published photos per kind, nullable attributes, attribution after account deletion, and admin-only moderation.
- Every write derives its actor from a verified session; client IDs cannot authorize writes.
- Use cf configuration, local resources by default, the latest locally supported compatibility date, and generated binding types.
- Never log tokens or commit credentials; external email delivery requires configured credentials.
- Keep existing user workspace files. Do not publish, provision production resources, import production data, or commit without a concrete need and authorization.

## Review Focus

- Direct unauthenticated POSTs and cross-user edits/deletions must fail even when loaders are bypassed.
- Failed photo inserts must roll back the entire submission; concurrent claims cannot overwrite ownership.
- Unknown attributes, empty arrays, zero walk time, and false dog-friendly values must remain distinct.
- Magic-link redemption must create a verified session and reject replay; OAuth callback cookies must survive.
- Removed photos and expired abandoned uploads must not remain publicly accessible or attachable.

### Task 1: D1 schema and runtime scaffolding

**Files:** `migrations/*.sql`, `cloudflare.config.ts`, `vite.config.ts`, `workers/app.ts`, `app/entry.server.tsx`, `tsconfig.json`, `package.json`, `tests/d1/helpers.ts`, `tests/d1/schema.test.ts`.

**Interfaces:** D1 binding `DB`, R2 binding `PHOTOS`; `DataContext { db, viewer }` where viewer includes verified user ID, email, email verification, and application role.

- [x] Write and run failing schema tests covering vote uniqueness, photo rights/caps, profile deletion, arrays, and foreign keys.
- [x] Implement auth/application schemas and SQLite triggers, Workers build integration, and generated types.
- [x] Verify migrations in SQLite and Miniflare; preserve all domain unit tests.

### Task 2: D1 read repositories

**Files:** `app/data/{context,profiles,spots}.ts`, `app/domain/geo/distance.ts`, `tests/d1/reads.test.ts`.

**Interfaces:** Existing public return shapes; repository functions take `DataContext` first. Add `listShootTypes(context)`.

- [x] Add failing viewport, attribute-filter, ordering, media-visibility, and proximity tests.
- [x] Replace PostgREST/PostGIS with prepared SQL, JSON filters, indexed bounds, and Haversine candidate checks.
- [x] Verify filters precede limits and hidden spots never appear in public reads.

### Task 3: Authorized contribution commands

**Files:** `app/data/{spot-writes,signals,comments,scores,studios,reports}.ts`, `tests/d1/writes.test.ts`, `tests/d1/moderation.test.ts`.

**Interfaces:** Preserve existing command names; first argument is `DataContext`. Actor IDs come from its viewer. `createSpot` uses pre-generated IDs and a transactional batch.

- [x] Add failing authorization, rollback, vote-isolation, counter, claim, and moderation tests.
- [x] Implement allowlisted writes, conditional claims, atomic report resolution, and score refresh using shared domain functions.
- [x] Verify all contributor/admin/anonymous permutations and account deletion effects.

### Task 4: Better Auth and request context

**Files:** `app/lib/{auth,request-context,env}.server.ts`, `app/routes/auth.*`, `workers/app.ts`, `tests/d1/auth.test.ts`.

**Interfaces:** `createAuth(env)` returns Better Auth with D1, Google, and magic links. `createRequestContext(request, env)` returns `{ store, headers, env, auth }`. Auth handler mounted at `/api/auth/*`.

- [x] Add failing real magic-link/session/replay tests with only email delivery replaced by a test transport.
- [x] Configure explicit origins, secure session handling, database-backed rate limiting, verified email, and Resend delivery.
- [x] Replace all loader/action Supabase contexts and propagate response cookies.

### Task 5: R2 upload and delivery

**Files:** `app/lib/photo-*`, `app/lib/uploads.server.ts`, resource routes, `tests/d1/uploads.test.ts`.

**Interfaces:** Same-origin authenticated upload returns `{ storagePath }`; the browser retains image dimensions. Media URL is `/media/<key>`. D1 receipts prove ownership and existence when attaching photos.

- [x] Add failing upload validation, ownership, expiration, moderation, and abandonment tests.
- [x] Read authenticated uploads with an 8 MB bound and send known-length bytes to R2; validate receipt attachment transactionally; enforce visibility when serving media.
- [x] Replace browser Supabase clients while retaining browser downscaling.

### Task 6: Jobs, local tooling, and migration documentation

**Files:** `app/jobs/*`, `scripts/*`, `README.md`, `.env.example`, `docs/STATUS.md`, `docs/ENGINEERING-NOTES.md`, `vitest.config.ts`.

**Interfaces:** Scheduled handler refreshes hot scores and sweeps expired upload receipts. Local seed and migrations use local bindings. Production migrations require explicit remote commands.

- [x] Add failing score-refresh, quiet-spot reset, cleanup, and import-preservation tests.
- [x] Port seed/backfill/refresh tooling; preserve legacy SQL as migration reference and replace Supabase integration suites with D1 behavior suites.
- [x] Document Google/Resend secrets, deployment, export/import identity preservation, and session cutover.

### Task 7: Final runtime verification and review

- [x] Run the full unit and D1 suites, typecheck, production Worker build, and HTTP smoke tests in workerd.
- [x] Verify real Better Auth sessions, direct unauthorized actions, media delivery, and scheduled behavior using local resources.
- [x] Obtain a fresh whole-change review, fix important findings with regression tests, and report any external credentials still needed.
