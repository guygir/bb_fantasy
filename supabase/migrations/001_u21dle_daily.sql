-- U21dle daily puzzle: one player per date (never overwrite once set)
CREATE TABLE IF NOT EXISTS u21dle_daily (
  puzzle_date DATE PRIMARY KEY,
  player_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: anon can read (for game), service_role can insert (for cron)
ALTER TABLE u21dle_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read" ON u21dle_daily;
CREATE POLICY "Allow public read"
  ON u21dle_daily FOR SELECT
  USING (true);

-- Only service_role can insert (no policy = only bypass RLS with service key)
-- No UPDATE/DELETE policy = existing rows cannot be changed
