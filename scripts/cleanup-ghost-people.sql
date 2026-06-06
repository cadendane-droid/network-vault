-- One-time cleanup: remove ghost people rows auto-created by the old
-- resolve-people logic in the Inngest extract job.
--
-- A ghost row is a person who:
--   1. Has no facts (nothing was ever extracted about them)
--   2. Is not a participant in any conversation
--   3. Is not connected by any edge in either direction
--
-- People satisfying all three criteria have no data attached to them and
-- were never explicitly submitted through the Add Person form — they exist
-- only because a previous version of the pipeline created rows for every
-- name Claude mentioned.
--
-- CAUTION: this will also delete legitimately added people whose extraction
-- job failed completely (0 facts written). If any such people exist and you
-- want to keep them, add them back manually after running this script.
--
-- Preview first (SELECT instead of DELETE):
--   SELECT id, name, created_at FROM people
--   WHERE ...  (same WHERE clause, replace DELETE with SELECT id, name, created_at)
--
-- Apply with:
--   npx prisma db execute --file scripts/cleanup-ghost-people.sql

-- Preview (run this first to see what will be deleted):
-- SELECT id, name, created_at
-- FROM people
-- WHERE id NOT IN (SELECT DISTINCT person_id FROM facts)
--   AND id NOT IN (SELECT DISTINCT person_id FROM conversation_participants)
--   AND id NOT IN (SELECT DISTINCT person_a FROM edges)
--   AND id NOT IN (SELECT DISTINCT person_b FROM edges);

-- Delete:
DELETE FROM people
WHERE id NOT IN (SELECT DISTINCT person_id FROM facts)
  AND id NOT IN (SELECT DISTINCT person_id FROM conversation_participants)
  AND id NOT IN (SELECT DISTINCT person_a FROM edges)
  AND id NOT IN (SELECT DISTINCT person_b FROM edges);
