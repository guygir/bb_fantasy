-- U21dle puzzles: id UUID so guesses reference it. When puzzle is replaced, new id = fresh game.
-- Migrates from u21dle_daily (001) if it exists.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS u21dle_puzzles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  puzzle_date DATE UNIQUE NOT NULL,
  player_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_u21dle_puzzles_date ON u21dle_puzzles(puzzle_date);

-- Migrate from u21dle_daily if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'u21dle_daily') THEN
    INSERT INTO u21dle_puzzles (id, puzzle_date, player_id, created_at)
    SELECT uuid_generate_v4(), puzzle_date, player_id, created_at
    FROM u21dle_daily
    ON CONFLICT (puzzle_date) DO NOTHING;
    DROP TABLE u21dle_daily;
  END IF;
END $$;

ALTER TABLE u21dle_puzzles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view current and past puzzles"
  ON u21dle_puzzles FOR SELECT
  USING (puzzle_date <= CURRENT_DATE);

-- Service role inserts (cron); no UPDATE/DELETE for normal flow
CREATE POLICY "Service role can insert puzzles"
  ON u21dle_puzzles FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
