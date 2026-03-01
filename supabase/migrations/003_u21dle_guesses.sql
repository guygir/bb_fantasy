-- U21dle guesses: one row per (user, puzzle). Stores guesses, game state (including in-progress).
-- When puzzle is replaced (new id), user has no entry = fresh game.

CREATE TABLE IF NOT EXISTS u21dle_guesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  puzzle_id UUID NOT NULL REFERENCES u21dle_puzzles(id) ON DELETE CASCADE,
  guess_history JSONB NOT NULL DEFAULT '[]',
  guesses_used INTEGER NOT NULL DEFAULT 0,
  is_solved BOOLEAN NOT NULL DEFAULT false,
  time_taken_seconds INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  game_started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS idx_u21dle_guesses_user ON u21dle_guesses(user_id);
CREATE INDEX IF NOT EXISTS idx_u21dle_guesses_puzzle ON u21dle_guesses(puzzle_id);
CREATE INDEX IF NOT EXISTS idx_u21dle_guesses_submitted ON u21dle_guesses(submitted_at DESC);

ALTER TABLE u21dle_guesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own guesses"
  ON u21dle_guesses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own guesses"
  ON u21dle_guesses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own guesses"
  ON u21dle_guesses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Leaderboard: allow reading all guesses (or service_role)
CREATE POLICY "Anyone can view guesses for leaderboard"
  ON u21dle_guesses FOR SELECT
  USING (true);

COMMENT ON COLUMN u21dle_guesses.guess_history IS 'Array of {player, feedback} objects per guess';
COMMENT ON COLUMN u21dle_guesses.is_solved IS 'true when user guessed correctly or ran out of guesses';
