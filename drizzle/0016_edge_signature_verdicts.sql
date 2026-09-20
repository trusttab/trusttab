CREATE TABLE "agent_keys" (
	"identity" text NOT NULL,
	"kid" text NOT NULL,
	"jwk" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_keys_identity_kid_pk" PRIMARY KEY("identity","kid")
);
--> statement-breakpoint
ALTER TABLE "site_agent_hits" ADD COLUMN "edge_signature_verdict" text;--> statement-breakpoint
CREATE INDEX "agent_keys_identity_idx" ON "agent_keys" USING btree ("identity");