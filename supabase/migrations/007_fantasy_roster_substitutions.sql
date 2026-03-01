-- Fantasy: substitution audit (when user swaps players)

CREATE TABLE IF NOT EXISTS fantasy_roster_substitutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  removed_player_ids INTEGER[] NOT NULL,
  added_player_ids INTEGER[] NOT NULL,
  removed_prices JSONB DEFAULT '{}',
  added_prices JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fantasy_subs_user ON fantasy_roster_substitutions(user_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_subs_season ON fantasy_roster_substitutions(season);

ALTER TABLE fantasy_roster_substitutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own substitutions"
  ON fantasy_roster_substitutions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own substitutions"
  ON fantasy_roster_substitutions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
