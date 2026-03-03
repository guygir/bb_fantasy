-- Store total fantasy points per user roster. Updated by sync script.
-- Single source of truth for leaderboard; avoids recomputing from rosters/subs/stats.
ALTER TABLE fantasy_user_rosters
  ADD COLUMN IF NOT EXISTS total_fantasy_points DECIMAL(8,2) DEFAULT NULL;

COMMENT ON COLUMN fantasy_user_rosters.total_fantasy_points IS 'Sum of FP from roster players across played matches. Updated by sync-fantasy-to-supabase.';
