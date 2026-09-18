CREATE TABLE "owner_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_agent_hits" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "owner_agents" ADD CONSTRAINT "owner_agents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_agents_site_id_idx" ON "owner_agents" USING btree ("site_id");