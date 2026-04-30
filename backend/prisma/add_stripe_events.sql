-- Migration: create stripe_events table for webhook idempotency
-- Run this in the Supabase SQL editor before deploying the updated backend.

CREATE TABLE IF NOT EXISTS stripe_events (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  stripe_event_id TEXT NOT NULL UNIQUE,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
