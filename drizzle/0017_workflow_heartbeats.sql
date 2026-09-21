CREATE TABLE "workflow_pings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"cadence" text NOT NULL,
	"ping_token_hash" text NOT NULL,
	"last_ping_at" timestamp with time zone,
	"ping_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_pings" ADD CONSTRAINT "workflow_pings_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_pings_workflow_id_idx" ON "workflow_pings" USING btree ("workflow_id","received_at");--> statement-breakpoint
CREATE INDEX "workflows_user_id_idx" ON "workflows" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_ping_token_hash_idx" ON "workflows" USING btree ("ping_token_hash");