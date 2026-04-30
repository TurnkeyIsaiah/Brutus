-- Email sequence + first-call popup migration
-- Run in Supabase SQL editor BEFORE deploying the new code.
--
-- What this does:
-- 1. Creates email_logs table with unique constraint on (user_id, type)
--    so the hourly scheduler can insert idempotently.
-- 2. Adds popup_feedback JSONB column to calls for the first-call feedback popup.
--
-- Types match Prisma's String defaults (TEXT in Postgres, not UUID).

BEGIN;

-- 1. Email sequence audit log
CREATE TABLE IF NOT EXISTS email_logs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- "day1" | "day3" | "day7"
  status      TEXT NOT NULL DEFAULT 'sent', -- "sent" | "failed"
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint enforces "send each email type to each user at most once"
CREATE UNIQUE INDEX IF NOT EXISTS email_logs_user_id_type_key
  ON email_logs(user_id, type);

CREATE INDEX IF NOT EXISTS email_logs_user_id_idx
  ON email_logs(user_id);

-- 2. First-call popup feedback storage
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS popup_feedback JSONB;

COMMIT;
