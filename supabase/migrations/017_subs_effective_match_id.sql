-- Add effective_match_id to substitutions so weekly-history applies each sub only for its intended match.
-- Fixes roster mismatch (e.g. 6 players or wrong players) when using created_at was ambiguous.

ALTER TABLE fantasy_roster_substitutions
  ADD COLUMN IF NOT EXISTS effective_match_id TEXT;

CREATE INDEX IF NOT EXISTS idx_fantasy_subs_effective_match
  ON fantasy_roster_substitutions(user_id, season, effective_match_id)
  WHERE effective_match_id IS NOT NULL;

COMMENT ON COLUMN fantasy_roster_substitutions.effective_match_id IS 'Match this sub was applied for (set by sync). When set, weekly-history applies sub only for this match.';
