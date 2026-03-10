-- Run this in the Supabase SQL editor after `npx prisma db push`
-- Supabase already has pgvector installed — this just enables it for your project.

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add the embedding column (1536 dims = text-embedding-3-small output size)
ALTER TABLE training_moments
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. IVFFlat index for fast cosine similarity search
--    lists=100 is appropriate for up to ~10,000 rows.
--    If the table grows significantly, re-run:
--    DROP INDEX training_moments_embedding_idx;
--    CREATE INDEX ... WITH (lists = sqrt(row_count));
CREATE INDEX IF NOT EXISTS training_moments_embedding_idx
  ON training_moments
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Verify:
-- SELECT COUNT(*), moment_type FROM training_moments GROUP BY moment_type;
