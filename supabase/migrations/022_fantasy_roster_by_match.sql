-- Snapshot roster per match when sync runs after game. Immutable - never changes.
-- Weekly-history reads from here instead of reconstructing from subs.

CREATE TABLE IF NOT EXISTS fantasy_roster_by_match (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  player_ids INTEGER[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, season, match_id)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_roster_by_match_lookup
  ON fantasy_roster_by_match(user_id, season);

ALTER TABLE fantasy_roster_by_match ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own roster by match"
  ON fantasy_roster_by_match FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE fantasy_roster_by_match IS 'Roster that played each match. Written by sync when game is done. Never updated.';
