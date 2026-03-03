-- Denormalize nickname onto fantasy_user_rosters for reliable display.
-- Avoids stale/cached profile fetches; roster + nickname come from same row.
ALTER TABLE fantasy_user_rosters
  ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Backfill from profiles
UPDATE fantasy_user_rosters r
SET nickname = p.nickname
FROM profiles p
WHERE r.user_id = p.user_id AND (r.nickname IS NULL OR r.nickname = '');

COMMENT ON COLUMN fantasy_user_rosters.nickname IS 'Display name; synced from profiles when user updates nickname.';
