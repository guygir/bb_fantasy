-- Fantasy: user rosters (replaces localStorage fantasy_roster_s71)

CREATE TABLE IF NOT EXISTS fantasy_user_rosters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  player_ids INTEGER[] NOT NULL,
  player_prices JSONB NOT NULL DEFAULT '{}',
  player_names JSONB NOT NULL DEFAULT '{}',
  picked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_rosters_user ON fantasy_user_rosters(user_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_rosters_season ON fantasy_user_rosters(season);

ALTER TABLE fantasy_user_rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own roster"
  ON fantasy_user_rosters FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own roster"
  ON fantasy_user_rosters FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own roster"
  ON fantasy_user_rosters FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Leaderboard: service role or allow read for ranking
CREATE POLICY "Anyone can view rosters for leaderboard"
  ON fantasy_user_rosters FOR SELECT
  USING (true);

COMMENT ON COLUMN fantasy_user_rosters.player_ids IS 'Array of 5 BuzzerBeater player IDs';
COMMENT ON COLUMN fantasy_user_rosters.player_prices IS 'JSONB {playerId: price} at pickup time';
COMMENT ON COLUMN fantasy_user_rosters.player_names IS 'JSONB {playerId: name} for display';
