import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A broken test glob must fail rather than silently report success.
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
          include: ["tests/d1/**/*.test.ts"],
          globals: false,
        },
      },
    ],
  },
});
