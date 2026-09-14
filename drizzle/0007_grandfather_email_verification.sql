-- Email verification is now required for new accounts. Accounts that existed
-- before this migration signed up when verification wasn't offered, so they
-- are treated as verified rather than locked out on their next sign-in.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
