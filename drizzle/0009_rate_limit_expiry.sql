-- Each bucket records when its window ends, so pruning never cuts a longer
-- window short (a day-long window used to be deleted after an hour). The
-- default keeps inserts from code deployed before this column working during
-- a deploy, and gives existing rows (all windows of 60s or less) a safe expiry.
ALTER TABLE "rate_limit_buckets" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '1 hour' NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets" USING btree ("expires_at");