import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — see .env.example");

/**
 * postgres-js speaks the standard wire protocol, so the same client serves
 * local Postgres in development and Neon in production. One driver, no
 * environment-specific branch to get wrong.
 *
 * Cached on globalThis so Next's dev server doesn't open a new pool on
 * every hot reload until the database refuses connections.
 */
const globalForDb = globalThis as unknown as {
  rbClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.rbClient ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.rbClient = client;

export const db = drizzle(client, { schema });
export { schema };
