import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

/**
 * A single shared connection pool per server instance.
 *
 * In development, Next.js hot-reloads modules, which would otherwise open a new
 * pool on every edit and eventually exhaust Postgres connections — so the
 * client is cached on `globalThis`.
 *
 * `prepare: false` keeps us compatible with transaction-mode connection
 * poolers (Neon's pooled endpoint, PgBouncer, Supabase's pooler).
 */
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };

const client =
  globalForDb.pgClient ?? postgres(databaseUrl, { prepare: false, max: 5 });

if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
