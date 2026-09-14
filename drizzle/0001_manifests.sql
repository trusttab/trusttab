CREATE TABLE "manifest_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_id" uuid NOT NULL,
	"path" text NOT NULL,
	"method" text NOT NULL,
	"purpose" text NOT NULL,
	"schema_json" jsonb NOT NULL,
	"agent_safe" boolean NOT NULL,
	"requires_captcha" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"payload_json" jsonb NOT NULL,
	"signature" text NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "verification_id" text;--> statement-breakpoint
ALTER TABLE "manifest_endpoints" ADD CONSTRAINT "manifest_endpoints_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_endpoints_manifest_id_idx" ON "manifest_endpoints" USING btree ("manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifests_site_version_uniq" ON "manifests" USING btree ("site_id","version");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_verification_id_unique" UNIQUE("verification_id");