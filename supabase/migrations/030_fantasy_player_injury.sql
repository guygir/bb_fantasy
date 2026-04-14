-- Injury window from BuzzerBeater player overview (fetch-player-details cron).
-- When null/null: healthy. When set: show "INJURED! min-max days" in UI.
ALTER TABLE fantasy_player_details
  ADD COLUMN IF NOT EXISTS injury_days_min INTEGER,
  ADD COLUMN IF NOT EXISTS injury_days_max INTEGER;

COMMENT ON COLUMN fantasy_player_details.injury_days_min IS 'Lower bound of BB "X - Y days" injury window; null if not injured.';
COMMENT ON COLUMN fantasy_player_details.injury_days_max IS 'Upper bound of BB injury window; null if not injured.';
