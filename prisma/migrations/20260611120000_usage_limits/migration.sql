-- Per-user usage-limit counters (beta caps).
-- reset_at columns record the UTC day/month the counter belongs to;
-- NULL means the user has never consumed that quota.
ALTER TABLE "users"
ADD COLUMN "daily_upload_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "daily_upload_reset_at" DATE,
ADD COLUMN "daily_query_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "daily_query_reset_at" DATE,
ADD COLUMN "monthly_query_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "monthly_query_reset_at" DATE;
