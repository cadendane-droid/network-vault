-- Enable Row Level Security on all 7 tables (Step 11 — previously skipped).
--
-- This app uses Clerk + Prisma for all database access. Prisma connects as the
-- postgres superuser (or project owner), which bypasses RLS by PostgreSQL
-- design. This means:
--
--   • The app's own queries are completely unaffected by these policies.
--   • The Supabase SQL editor (also postgres superuser) still sees all rows —
--     that is correct admin behaviour and cannot be changed with standard RLS.
--   • Any query from the Supabase anon or authenticated roles (e.g. a direct
--     Supabase JS client call with the anon key) now returns 0 rows.
--
-- No permissive policies are created because we do not use Supabase Auth
-- (auth.uid() is always NULL for Clerk users). With RLS enabled and no
-- permissive policies, the default for all non-privileged roles is DENY ALL.
--
-- To verify RLS is active after applying this migration, run in the SQL editor:
--   SET ROLE anon;
--   SELECT * FROM people;   -- must return 0 rows
--   RESET ROLE;

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE people                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources                ENABLE ROW LEVEL SECURITY;
ALTER TABLE facts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges                  ENABLE ROW LEVEL SECURITY;
