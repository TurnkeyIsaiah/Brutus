-- Migration: add token_version to users table
-- Run this in the Supabase SQL editor before deploying the updated backend.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- Purge all outstanding reset tokens — they are 1-hour tokens stored in plaintext.
-- After deploy, tokens are stored as SHA-256 hashes so legacy plaintext rows are unusable.
-- Any user mid-reset will need to request a new link (minor inconvenience, required for security).
DELETE FROM password_reset_tokens;
