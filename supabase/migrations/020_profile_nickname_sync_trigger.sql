-- When profiles.nickname is updated, automatically sync to fantasy_user_rosters.
-- Ensures leaderboard and roster displays always show the latest nickname,
-- regardless of how the profile was updated (API, manual SQL, etc.).
CREATE OR REPLACE FUNCTION public.sync_profile_nickname_to_rosters()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.nickname IS DISTINCT FROM NEW.nickname THEN
    UPDATE fantasy_user_rosters
    SET nickname = NEW.nickname, updated_at = NOW()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profiles_nickname_update ON profiles;
CREATE TRIGGER on_profiles_nickname_update
  AFTER UPDATE OF nickname ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_nickname_to_rosters();

-- One-time: fix any existing mismatches (profiles updated but rosters not)
UPDATE fantasy_user_rosters r
SET nickname = p.nickname, updated_at = NOW()
FROM profiles p
WHERE r.user_id = p.user_id
  AND (r.nickname IS NULL OR r.nickname IS DISTINCT FROM p.nickname);
