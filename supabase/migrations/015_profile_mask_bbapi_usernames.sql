-- Mask existing BBAPI usernames: set nickname to User_hash for users whose
-- profile nickname still equals their BBAPI login (prevents exposing BBAPI username).
-- Uses 12-char hash to avoid collisions (unique index on LOWER(nickname)).

UPDATE profiles p
SET
  nickname = 'User_' || substr(replace(p.user_id::text, '-', ''), 1, 12),
  updated_at = NOW()
FROM bb_users b
WHERE b.auth_user_id = p.user_id
  AND LOWER(p.nickname) = LOWER(b.bbapi_login);
