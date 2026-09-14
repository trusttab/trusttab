ALTER TYPE "public"."site_status" ADD VALUE 'self_declared';--> statement-breakpoint
ALTER TABLE "manifest_endpoints" ADD COLUMN "self_attested" boolean DEFAULT false NOT NULL;