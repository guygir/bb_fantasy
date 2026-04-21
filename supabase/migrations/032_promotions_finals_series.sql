-- Add finals series tracking to promotions snapshots
-- Stores per-league finals info: teams, series score (best of 3)

ALTER TABLE promotions_snapshots ADD COLUMN IF NOT EXISTS finals_by_league JSONB;

COMMENT ON COLUMN promotions_snapshots.finals_by_league IS 
  'Per-league finals info keyed by league_id. Each entry has: leftTeamId, rightTeamId, leftWins, rightWins, champTeamId (null if undecided).';
