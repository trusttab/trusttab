-- Agent classification for requests to a site's public TrustTab endpoints.
-- Nullable: rows written before this existed keep no classification, and a
-- deploy in progress can still insert without these columns.
ALTER TABLE "manifest_hits" ADD COLUMN "agent_tier" text;--> statement-breakpoint
ALTER TABLE "manifest_hits" ADD COLUMN "agent_identity" text;--> statement-breakpoint
ALTER TABLE "manifest_hits" ADD COLUMN "agent_signal" text;