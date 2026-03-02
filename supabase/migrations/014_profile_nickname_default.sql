-- For BBAPI users: use User_hash as default nickname instead of BBAPI username.
-- Prevents exposing BBAPI login across the site.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  base_nick TEXT;
  try_nick TEXT;
  suffix INT := 1;
BEGIN
  -- BBAPI users: use User_hash, never expose BBAPI username
  IF new.email LIKE '%@bbapi.buzzerbeater.local' THEN
    base_nick := 'User_' || substr(replace(new.id::text, '-', ''), 1, 12);
  ELSE
    base_nick := COALESCE(TRIM(new.raw_user_meta_data->>'nickname'), split_part(COALESCE(new.email, ''), '@', 1), 'Player');
  END IF;
  try_nick := base_nick;

  WHILE EXISTS (
    SELECT 1 FROM public.profiles
    WHERE LOWER(nickname) = LOWER(try_nick) AND user_id != new.id
  ) LOOP
    suffix := suffix + 1;
    try_nick := base_nick || '_' || suffix;
  END LOOP;

  INSERT INTO public.profiles (user_id, nickname, updated_at)
  VALUES (new.id, try_nick, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    nickname = EXCLUDED.nickname,
    updated_at = NOW();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
