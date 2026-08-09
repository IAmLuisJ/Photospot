import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/db/ doesn't exist yet (added in a later task); an empty "db"
    // project shouldn't fail the run. This must live on the root config —
    // Vitest doesn't honor passWithNoTests set per-project.
    passWithNoTests: true,
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
