# Photospots

A map of photography locations, cultivated by local photographers. Launching in Grand Rapids,
Michigan, with shoot-type filters, practical location details, scouting and session photos,
votes, comments, studio claims, and moderation.

**Live:** [photospots.luisisthejuarez.workers.dev](https://photospots.luisisthejuarez.workers.dev).
Email magic-link sign-in is configured; Google requires OAuth credentials.

Runs on **Cloudflare Workers, D1 and private R2**, with **Better Auth** for Google sign-in and
email magic links delivered by Resend. The browser uses same-origin Worker endpoints;
database bindings, authorization and storage credentials stay on the server.

## Local setup

Use Node **24.22+ within v24**, **22.23+ within v22**, or **26.12+ within v26**; see `engines`.
Docker and a Supabase project are no longer required.

```bash
npm ci
cp .env.example .env
cp .dev.vars.example .dev.vars
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Put the generated value in `BETTER_AUTH_SECRET` in `.dev.vars`, which is ignored by Git.
Leave optional provider credentials blank to browse without signing in, or configure Google
and/or Resend following [the deployment guide](docs/CLOUDFLARE.md).

```bash
npm run db:migrate
npm run seed
npm run dev
```

Open `http://localhost:5173`. The optional seed adds six Grand Rapids spots and twelve SVG
placeholders and is safe to run again. Stop the dev server before standalone data scripts.
Local resources persist in `.cloudflare/state/v3`. The migration script always uses `--local`.

## Commands

| Command                                                  | Purpose                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                                            | React Router SSR in the Workers development runtime         |
| `npm test`                                               | Domain/UI unit tests and SQLite integration tests           |
| `npm run test:unit`                                      | Unit tests only                                             |
| `npm run test:db`                                        | D1 repository, auth, route, upload, import and job tests    |
| `npm run typecheck`                                      | Generate Cloudflare/React Router types and check TypeScript |
| `npm run build`                                          | Build production Worker and browser assets                  |
| `npm start`                                              | Preview the production build locally                        |
| `npm run test:runtime`                                   | Build and test HTTP flows in workerd with native D1/R2      |
| `npm run db:migrate`                                     | Apply local D1 migrations                                   |
| `npm run seed`                                           | Add local fixtures                                          |
| `npm run backfill:scores`                                | Recompute local lifetime scores                             |
| `npm run refresh:hot`                                    | Recompute local time-decayed scores                         |
| `npm run import:legacy -- snapshot.json`                 | Import a snapshot into empty local D1                       |
| `npm run check:deploy`                                   | Check production database UUID and HTTPS origin             |
| `npm run deploy -- --secrets-file /path/to/secrets.json` | Check, build and deploy                                     |

Run `typecheck` before `build`: type generation evaluates Vite config and can clear its build
output. Runtime tests isolate their database, bucket and captured email; external credentials
and real email delivery are unnecessary.

## Architecture

| Directory        | Responsibility                                            |
| ---------------- | --------------------------------------------------------- |
| `app/domain/`    | Pure scoring, geography, validation and filtering         |
| `app/data/`      | Prepared D1 queries and actor-scoped commands             |
| `app/lib/`       | Auth, request context, environment, uploads and media     |
| `app/routes/`    | React Router loaders, actions and UI                      |
| `app/jobs/`      | Ranking refresh and abandoned-upload cleanup              |
| `workers/app.ts` | Fetch and scheduled entry points                          |
| `migrations/`    | Active SQLite/D1 schema, constraints and triggers         |
| `scripts/`       | Local tools and legacy export/import bridge               |
| `tests/d1/`      | Real SQLite tests through the D1 binding interface        |
| `supabase/`      | Historical Postgres schema and archived integration tests |

D1 has no Supabase RLS. Server repositories enforce authorization with actor-scoped SQL,
allowlisted fields, constraints and transactional batches. Client IDs and roles cannot
authorize writes. Scoring weights remain in `app/domain/scoring/weights.ts`; hourly maintenance
refreshes rankings and removes abandoned uploads. R2 remains private, and `/media/*` checks
photo and parent-spot publication on every request.

Follow [CLOUDFLARE.md](docs/CLOUDFLARE.md) for resources, secrets, Google callbacks, deployment,
and existing-user/data cutover. See [status](docs/STATUS.md), [engineering notes](docs/ENGINEERING-NOTES.md),
and [design/plans](docs/superpowers/) for further context.

## History

The Expo prototype is preserved at the
[`legacy-expo-mvp`](https://github.com/IAmLuisJ/Photospot/tree/legacy-expo-mvp) tag.
