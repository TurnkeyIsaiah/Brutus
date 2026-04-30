-- Email verification migration
-- Run in Supabase SQL editor BEFORE deploying the new code.
--
-- What this does:
-- 1. Adds email_verified column (default false for new users)
-- 2. Backfills email_verified=true for ALL existing users
--    (we trust them — they signed up before this gate existed and the abuse vector is forward-looking)
-- 3. Creates email_verification_tokens table for the verify-email flow
-- 4. Changes the token_balance default from 500000 to 0
--    (existing users keep their current balance — only new signups get 0 until verified)

BEGIN;

-- 1. Add the column with a sane default for new rows
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- 2. Existing users are grandfathered in
UPDATE users SET email_verified = true WHERE email_verified = false;

-- 3. Verification token table
-- IMPORTANT: id and user_id are TEXT, not UUID, to match the existing users.id type
-- (Prisma's String @id @default(uuid()) maps to TEXT in Postgres unless @db.Uuid is set,
-- and password_reset_tokens follows the same pattern.)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx
  ON email_verification_tokens(user_id);

-- 4. New signups must verify before getting tokens
ALTER TABLE users
  ALTER COLUMN token_balance SET DEFAULT 0;

COMMIT;
