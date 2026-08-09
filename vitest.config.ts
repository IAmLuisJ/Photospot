import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Deliberately no passWithNoTests here. On the root config it applies to
    // the whole run, so a broken glob would exit 0 with nothing executed.
    // `tests/db/` doesn't exist until task 6, and Vitest ignores the flag when
    // set per-project, so the `test:db` script passes it on the command line
    // instead — per-invocation, and it can't leak into `npm test`.
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.{ts,tsx}"],
          globals: false,
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globals: false,
          // These tests all hit one shared Postgres instance (e.g. task 15's
          // backfill rewrites spots.score across every row) so they must not
          // run as concurrent files.
          fileParallelism: false,
        },
      },
    ],
  },
});
