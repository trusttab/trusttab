import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so load env files the same way Next does
// for local development. `.env.local` wins over `.env`.
config({ path: [".env.local", ".env"], quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (see .env.example).");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
});
