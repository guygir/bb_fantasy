-- Add match_start (TIMESTAMPTZ) for sub lock window: 1h after prev game until 1h before next game.
-- BBAPI returns start as ISO 8601 UTC (e.g. 2026-02-23T18:30:00Z).

ALTER TABLE fantasy_schedule
  ADD COLUMN IF NOT EXISTS match_start TIMESTAMPTZ;

COMMENT ON COLUMN fantasy_schedule.match_start IS 'Game start time UTC from BBAPI schedule';
