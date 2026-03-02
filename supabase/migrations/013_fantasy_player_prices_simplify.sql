-- Simplify fantasy_player_prices: one row per (season, player_id), current price only.
-- Remove effective_from; no history in DB (JSON keeps history for simulation).

-- Create new table
CREATE TABLE fantasy_player_prices_new (
  season INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (season, player_id)
);

-- Migrate: keep one row per (season, player_id) - latest by effective_from
INSERT INTO fantasy_player_prices_new (season, player_id, price, updated_at)
SELECT DISTINCT ON (season, player_id) season, player_id, price, updated_at
FROM fantasy_player_prices
ORDER BY season, player_id, effective_from DESC;

-- Drop old table (policies drop with it)
DROP TABLE fantasy_player_prices;

-- Rename
ALTER TABLE fantasy_player_prices_new RENAME TO fantasy_player_prices;

CREATE INDEX IF NOT EXISTS idx_fantasy_prices_season ON fantasy_player_prices(season);

ALTER TABLE fantasy_player_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read fantasy_player_prices" ON fantasy_player_prices FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_player_prices" ON fantasy_player_prices FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
