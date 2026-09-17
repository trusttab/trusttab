CREATE TABLE "site_agent_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"path" text,
	"agent_tier" text NOT NULL,
	"agent_identity" text,
	"agent_signal" text,
	"requester_ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "agent_traffic_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "agent_traffic_token_hash" text;--> statement-breakpoint
ALTER TABLE "site_agent_hits" ADD CONSTRAINT "site_agent_hits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_agent_hits_site_created_at_idx" ON "site_agent_hits" USING btree ("site_id","created_at");