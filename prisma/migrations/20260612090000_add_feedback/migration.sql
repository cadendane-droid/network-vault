-- Feedback table — in-app feedback submissions.
-- Read access is admin-only (ADMIN_CLERK_IDS), enforced in the API layer
-- like every other table; RLS below is the deny-all backstop.

CREATE TABLE "feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "page" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indexes (naming convention from 20260530180000_indexes)
CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);

-- RLS backstop — same convention as 20260606120000_rls: enable with no
-- permissive policies. Prisma connects as the table owner (bypasses RLS);
-- Supabase anon/authenticated roles get default DENY ALL.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
