-- Add team names and match type to fantasy_schedule so getSchedule() can fully fall back to Supabase
-- when BBAPI is unavailable and the local JSON cache is stale (e.g. SF/Final added mid-season).

ALTER TABLE fantasy_schedule
  ADD COLUMN IF NOT EXISTS home_team_name TEXT,
  ADD COLUMN IF NOT EXISTS away_team_name TEXT,
  ADD COLUMN IF NOT EXISTS match_type TEXT;

COMMENT ON COLUMN fantasy_schedule.home_team_name IS 'Home team display name from BBAPI schedule XML';
COMMENT ON COLUMN fantasy_schedule.away_team_name IS 'Away team display name from BBAPI schedule XML';
COMMENT ON COLUMN fantasy_schedule.match_type     IS 'Match type from BBAPI (e.g. nt.roundrobin, nt.friendly, nt.semifinal, nt.final)';
