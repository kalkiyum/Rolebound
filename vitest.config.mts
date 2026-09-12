import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // dotenv first, then test/env.ts drops deployment-only settings and
    // test/db.ts overrides DATABASE_URL — the suite must never run against
    // the development database, nor read config meant for the deployed chain.
    setupFiles: ["dotenv/config", "test/env.ts", "test/db.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Anvil deploys and the database are both shared state; give them room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    // The gate talks to a real database; parallel suites would race on rows.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws unless resolved through React's "react-server"
      // condition, which vitest does not set. Point it at the package's own
      // no-op entry so server modules stay importable under test.
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
});
