-- Switch embedding column from vector(1536) to vector(1024)
-- voyage-3 (Voyage AI) produces 1024-dimensional vectors.
-- All existing embedding values are NULL so this is a lossless change.
ALTER TABLE facts DROP COLUMN IF EXISTS embedding;
ALTER TABLE facts ADD COLUMN embedding vector(1024);

-- Create the ivfflat index for pgvector cosine similarity search (DM §8)
-- lists=100 is appropriate for up to ~1M rows; revisit if vault grows significantly.
CREATE INDEX idx_facts_embedding ON facts
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
