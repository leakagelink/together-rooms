import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * PHASE 15 — deterministic test execution.
 *
 * The `scripts/security/**` suites create real end-user accounts against the
 * backend. Running those files in parallel tripped the auth provider's
 * per-IP sign-up rate limit, which surfaced as random suite-level failures
 * that had nothing to do with the code under test. Running test FILES
 * sequentially removes that shared-resource contention; tests inside a file
 * still run normally.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
