-- Declared intent (Web Bot Auth): what a signing agent said it was here to
-- do, recorded only when the declaration was covered by its signature, plus
-- whether the request it actually made fell outside that declaration.
ALTER TABLE "manifest_hits" ADD COLUMN "declared_intent" text;--> statement-breakpoint
ALTER TABLE "site_agent_hits" ADD COLUMN "declared_intent" text;--> statement-breakpoint
ALTER TABLE "site_agent_hits" ADD COLUMN "scope_mismatch" text;