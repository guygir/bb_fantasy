-- Pending substitutions: stored on roster, applied when next game is played.
-- Structure: { removed_ids: [n,n], added_ids: [n,n], added_prices: {}, added_names: {}, effective_match_id: "..." }

ALTER TABLE fantasy_user_rosters
  ADD COLUMN IF NOT EXISTS pending_subs JSONB DEFAULT NULL;

COMMENT ON COLUMN fantasy_user_rosters.pending_subs IS 'Subs to apply when effective_match_id game is played: {removed_ids, added_ids, added_prices, added_names, effective_match_id}';
