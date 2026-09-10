/**
 * The suite gets its own database, for the same reason it gets its own anvil
 * port: the tests wipe every table between cases, and pointing them at the
 * development database means `pnpm test` silently deletes the seeded demo.
 *
 * Imported by the global setup (which creates and migrates it) and by every
 * worker as a setup file, before anything touches src/db.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/rolebound_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
