-- Israel League III promotions: top teams across League 3 conferences (scraped from BB)

CREATE TABLE IF NOT EXISTS promotions_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promotions_entries (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES promotions_snapshots(id) ON DELETE CASCADE,
  display_rank INTEGER NOT NULL CHECK (display_rank >= 1 AND display_rank <= 32),
  league_id INTEGER NOT NULL,
  conf SMALLINT NOT NULL CHECK (conf IN (1, 2)),
  conf_rank INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  pd INTEGER NOT NULL,
  league_name TEXT NOT NULL,
  UNIQUE (snapshot_id, display_rank)
);

CREATE INDEX IF NOT EXISTS idx_promotions_entries_snapshot ON promotions_entries(snapshot_id);

ALTER TABLE promotions_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read promotions_snapshots" ON promotions_snapshots FOR SELECT USING (true);
CREATE POLICY "Anyone can read promotions_entries" ON promotions_entries FOR SELECT USING (true);
CREATE POLICY "Service role manages promotions_snapshots" ON promotions_snapshots FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role manages promotions_entries" ON promotions_entries FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
