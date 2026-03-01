-- U21dle user stats: aggregate stats (total games, wins, streaks, solved distribution).

CREATE TABLE IF NOT EXISTS u21dle_user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_games INTEGER DEFAULT 0,
  failed_games INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  max_streak INTEGER DEFAULT 0,
  total_score INTEGER DEFAULT 0,
  average_guesses DECIMAL(5,2) DEFAULT 0,
  last_played_date DATE,
  solved_distribution JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_u21dle_user_stats_score ON u21dle_user_stats(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_u21dle_user_stats_streak ON u21dle_user_stats(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_u21dle_user_stats_last_played ON u21dle_user_stats(last_played_date DESC);

ALTER TABLE u21dle_user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own stats"
  ON u21dle_user_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stats"
  ON u21dle_user_stats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stats"
  ON u21dle_user_stats FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view stats for leaderboard"
  ON u21dle_user_stats FOR SELECT
  USING (true);

COMMENT ON COLUMN u21dle_user_stats.solved_distribution IS 'JSONB e.g. {"1": 5, "2": 3} = 5 wins in 1 guess, 3 in 2 guesses';
COMMENT ON COLUMN u21dle_user_stats.average_guesses IS 'Average guesses per solved game';
