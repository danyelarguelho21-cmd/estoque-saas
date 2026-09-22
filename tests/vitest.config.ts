import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// QA-owned root test config for tests/unit + tests/integration (loop-protocol Rule 4 — this
// tree and its runner config are QA's oracle of record; engineers must not weaken it).
// Run from repo root:
//   npx vitest run --config tests/vitest.config.ts                 (unit + integration)
//   npx vitest run --config tests/vitest.config.ts tests/unit       (unit only, no DB needed)
//   npx vitest run --config tests/vitest.config.ts tests/integration (needs docker-compose.test.yml up)
const ciOnlyOptions = process.env.CI
  ? { reporters: ["default", "junit"], outputFile: { junit: "tests/coverage/junit-vitest.xml" } }
  : {};

export default defineConfig({
  test: {
    root: path.resolve(__dirname, ".."),
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "tests/coverage/html",
      include: ["services/app/src/modules/**", "libs/shared/src/**"],
    },
    ...ciOnlyOptions,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../services/app/src"),
    },
  },
});
