-- Traffic-log IPs are now stored coarsened (IPv4 /24, IPv6 /48) and kept for
-- 30 days. Bring rows written before that change in line.
UPDATE "manifest_hits"
SET "requester_ip" = regexp_replace("requester_ip", '\.[0-9]+$', '.0')
WHERE "requester_ip" ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$';--> statement-breakpoint
-- IPv6 (and anything else) is dropped rather than parsed in SQL.
UPDATE "manifest_hits"
SET "requester_ip" = NULL
WHERE "requester_ip" IS NOT NULL AND "requester_ip" !~ '^[0-9]+\.[0-9]+\.[0-9]+\.0$';--> statement-breakpoint
DELETE FROM "manifest_hits" WHERE "created_at" < now() - interval '30 days';
