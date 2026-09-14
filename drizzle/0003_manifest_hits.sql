CREATE TABLE "manifest_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"requester_ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manifest_hits" ADD CONSTRAINT "manifest_hits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_hits_site_created_at_idx" ON "manifest_hits" USING btree ("site_id","created_at");