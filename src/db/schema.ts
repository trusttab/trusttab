/**
 * Database schema (Drizzle ORM, Postgres).
 *
 * Two groups of tables live here:
 *
 * 1. Auth tables (`users`, `sessions`, `accounts`, `verifications`) — shaped
 *    exactly the way Better Auth expects. Column names in TypeScript must match
 *    Better Auth's field names (camelCase); the SQL column names are snake_case.
 *    Note: password hashes live in `accounts.password` (Better Auth keeps
 *    credentials per-provider), not on `users` as the original data model in
 *    CLAUDE.md sketched.
 *
 * 2. TrustTab tables (`sites`, and from Day 2 onward `manifests`,
 *    `manifest_endpoints`, `verification_runs`, `manifest_hits`).
 *
 * After editing this file run `npm run db:generate` to produce a SQL migration
 * in /drizzle, review it, and commit it alongside the schema change.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Relative (not "@/") because drizzle-kit loads this file outside Next.js.
import type { Manifest, ManifestInput } from "../lib/manifest/types";
import type { VerificationResults } from "../lib/verification/types";

// ---------------------------------------------------------------------------
// Auth (Better Auth)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Password hash for the email/password provider. Never returned by the API. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// TrustTab
// ---------------------------------------------------------------------------

/**
 * Overall trust status of a site. This reflects the *manifest verification
 * checks* (Day 3), not domain ownership — ownership is tracked separately in
 * `sites.ownership_verified_at`. A freshly claimed site whose ownership has
 * been proven is still `pending` until its manifest passes verification.
 */
export const siteStatus = pgEnum("site_status", [
  "pending",
  "verified",
  "needs_fix",
  "failed",
  // Automated checks passed except forms the owner self-attests. Distinct
  // from "verified" everywhere it is shown.
  "self_declared",
]);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Normalized hostname, e.g. `example.com` (lowercase, punycode, no `www.`). */
    domain: text("domain").notNull(),
    /**
     * Public registry ID (`tt_…`) that appears in manifests and badge lookups.
     * Assigned when the first manifest is published; stable across versions.
     */
    verificationId: text("verification_id").unique(),
    /** Random token the owner must publish in a `<meta name="agenttrust-verify">` tag. */
    verificationToken: text("verification_token").notNull(),
    ownershipVerifiedAt: timestamp("ownership_verified_at", { withTimezone: true }),
    status: siteStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sites_user_id_idx").on(t.userId),
    // A user can only claim a given domain once.
    uniqueIndex("sites_user_domain_uniq").on(t.userId, t.domain),
    // Any number of accounts may have a *pending* claim on a domain (so nobody
    // can squat a domain just by claiming it first), but only one account can
    // hold a *verified* claim at a time.
    uniqueIndex("sites_verified_domain_uniq")
      .on(t.domain)
      .where(sql`${t.ownershipVerifiedAt} IS NOT NULL`),
  ],
);

export type Site = typeof sites.$inferSelect;

/**
 * Every published manifest is kept as an immutable, signed version. The live
 * manifest for a site is the one with the highest `version`.
 */
export const manifests = pgTable(
  "manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Per-site revision number (1, 2, 3…). Not the manifest *format* version. */
    version: integer("version").notNull(),
    /** The exact signed manifest document, as served. */
    payloadJson: jsonb("payload_json").$type<Manifest>().notNull(),
    signature: text("signature").notNull(),
    /** Set when the verification checks pass (Day 3). Null until then. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("manifests_site_version_uniq").on(t.siteId, t.version)],
);

/**
 * The work-in-progress manifest for a site: what the editor shows and what
 * both the owner and the dashboard assistant edit. Nothing here is public or
 * signed. Publishing signs *this* row, identified by its content hash, and only
 * through the human publish flow (src/lib/publish-gate.ts).
 */
export const manifestDrafts = pgTable("manifest_drafts", {
  siteId: uuid("site_id")
    .primaryKey()
    .references(() => sites.id, { onDelete: "cascade" }),
  inputJson: jsonb("input_json").$type<ManifestInput>().notNull(),
  /** Incremented on every save; writers must name the version they edited. */
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").$type<"owner" | "assistant">().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Changes the assistant made to a draft since the last publish, with its
 * stated reason. Shown to the owner before they can publish; cleared on publish.
 */
export const draftChanges = pgTable(
  "draft_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    actor: text("actor").$type<"assistant">().notNull(),
    summary: text("summary").notNull(),
    reason: text("reason").notNull(),
    /** Draft version this change produced. */
    draftVersion: integer("draft_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("draft_changes_site_created_idx").on(t.siteId, t.createdAt)],
);

/**
 * Single-use, short-lived confirmations for publishing. Issued to a signed-in
 * browser session for one exact draft (by hash), consumed by the publish
 * request. Only the SHA-256 of the confirmation token is stored.
 */
export const publishConfirmations = pgTable("publish_confirmations", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  draftHash: text("draft_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** One row per "Re-check now": the outcome of every verification check. */
export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** The manifest version that was checked. */
    manifestId: uuid("manifest_id")
      .notNull()
      .references(() => manifests.id, { onDelete: "cascade" }),
    passed: boolean("passed").notNull(),
    resultsJson: jsonb("results_json").$type<VerificationResults>().notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_runs_site_run_at_idx").on(t.siteId, t.runAt)],
);

/**
 * One row per request to a site's public endpoints (the manifest and the
 * registry lookup), shown to the owner as a traffic log.
 */
export const manifestHits = pgTable(
  "manifest_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Which public endpoint was hit: "manifest" or "verify". */
    endpoint: text("endpoint").$type<"manifest" | "verify">().notNull(),
    /** Coarsened client IP (IPv4 /24, IPv6 /48); never the full address. */
    requesterIp: text("requester_ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("manifest_hits_site_created_at_idx").on(t.siteId, t.createdAt)],
);

/** Fixed-window request counters for rate limiting: public endpoints and auth (see src/lib/rate-limit.ts). */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    /** HMAC of `<bucket>:<client IP>` or `auth:<ip>|<path>`; never a raw IP. */
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
    /**
     * When the current window ends. Stored per row because windows differ
     * (seconds for sign-in, a day for AI text checks), so stale rows can be
     * pruned without cutting a longer window short.
     */
    // The default only covers code deployed before this column existed; current code always sets it.
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '1 hour'`),
  },
  (t) => [index("rate_limit_buckets_expires_at_idx").on(t.expiresAt)],
);

/**
 * Denormalized copy of each manifest's endpoints, so the verification engine
 * and dashboard can query endpoints without unpacking JSON.
 */
export const manifestEndpoints = pgTable(
  "manifest_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    manifestId: uuid("manifest_id")
      .notNull()
      .references(() => manifests.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    method: text("method").notNull(),
    // Plain text rather than a Postgres enum: the allowed values are defined
    // (and grow) in agent-trust.schema.json, which validates every write.
    purpose: text("purpose").notNull(),
    schemaJson: jsonb("schema_json").$type<Record<string, string>>().notNull(),
    agentSafe: boolean("agent_safe").notNull(),
    requiresCaptcha: boolean("requires_captcha").notNull(),
    selfAttested: boolean("self_attested").notNull().default(false),
  },
  (t) => [index("manifest_endpoints_manifest_id_idx").on(t.manifestId)],
);
