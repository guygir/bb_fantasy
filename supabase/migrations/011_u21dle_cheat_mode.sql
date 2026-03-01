-- U21dle: Add Cheat Mode support (like Riftle)
-- Cheat mode shows remaining candidates; cheat wins count less on leaderboard.

ALTER TABLE u21dle_guesses
  ADD COLUMN IF NOT EXISTS used_cheat BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE u21dle_user_stats
  ADD COLUMN IF NOT EXISTS cheat_distribution JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cheat_warning_seen BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_u21dle_guesses_used_cheat ON u21dle_guesses(used_cheat);

COMMENT ON COLUMN u21dle_guesses.used_cheat IS 'Whether cheat mode was enabled during this game';
COMMENT ON COLUMN u21dle_user_stats.cheat_distribution IS 'JSONB e.g. {"3": 2} = 2 wins in 3 guesses with cheat';
COMMENT ON COLUMN u21dle_user_stats.cheat_warning_seen IS 'User has seen and acknowledged cheat mode warning';
