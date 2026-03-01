-- Fantasy: game data (optional - replaces JSON when ready)
-- Populated by cron/scripts. Keeps players, stats, prices, matches in DB for querying.

-- Season roster / player stats (from season{N}_stats.json)
CREATE TABLE IF NOT EXISTS fantasy_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  gp INTEGER NOT NULL DEFAULT 0,
  min DECIMAL(5,2),
  pts DECIMAL(5,2),
  tr DECIMAL(5,2),
  ast DECIMAL(5,2),
  stl DECIMAL(5,2),
  blk DECIMAL(5,2),
  "to" DECIMAL(5,2),
  rtng DECIMAL(5,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, player_id)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_players_season ON fantasy_players(season);

-- Player details from BBAPI (from player_details_s{N}.json)
CREATE TABLE IF NOT EXISTS fantasy_player_details (
  season INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  position TEXT,
  dmi INTEGER,
  salary INTEGER,
  game_shape INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (season, player_id)
);

-- Player prices (from player_prices_s{N}.json)
CREATE TABLE IF NOT EXISTS fantasy_player_prices (
  season INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (season, player_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_prices_season ON fantasy_player_prices(season);

-- Per-game stats (from player_game_stats_s{N}.json)
CREATE TABLE IF NOT EXISTS fantasy_player_game_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  name TEXT,
  min INTEGER,
  pts INTEGER,
  tr INTEGER,
  ast INTEGER,
  stl INTEGER,
  blk INTEGER,
  "to" INTEGER,
  fantasy_points DECIMAL(6,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, player_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_fantasy_game_stats_season_match ON fantasy_player_game_stats(season, match_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_game_stats_player ON fantasy_player_game_stats(season, player_id);

-- Matches (from match_scores_s{N}.json)
CREATE TABLE IF NOT EXISTS fantasy_matches (
  season INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (season, match_id)
);

-- Schedule (from bbapi_schedule_s{N}.json)
CREATE TABLE IF NOT EXISTS fantasy_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  match_date DATE,
  home_team_id INTEGER,
  away_team_id INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, match_id)
);

-- RLS: anon can read (game data is public)
ALTER TABLE fantasy_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_player_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_player_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_player_game_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read fantasy_players" ON fantasy_players FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_players" ON fantasy_players FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Anyone can read fantasy_player_details" ON fantasy_player_details FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_player_details" ON fantasy_player_details FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Anyone can read fantasy_player_prices" ON fantasy_player_prices FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_player_prices" ON fantasy_player_prices FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Anyone can read fantasy_player_game_stats" ON fantasy_player_game_stats FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_player_game_stats" ON fantasy_player_game_stats FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Anyone can read fantasy_matches" ON fantasy_matches FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_matches" ON fantasy_matches FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Anyone can read fantasy_schedule" ON fantasy_schedule FOR SELECT USING (true);
CREATE POLICY "Service role manages fantasy_schedule" ON fantasy_schedule FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
