-- Profiles: display name for auth users (shared by U21dle + BB Fantasy).
-- Trigger: create profile on signup.

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_nickname_lower
  ON profiles(LOWER(nickname));

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  base_nick TEXT;
  try_nick TEXT;
  suffix INT := 1;
BEGIN
  base_nick := COALESCE(TRIM(new.raw_user_meta_data->>'nickname'), split_part(COALESCE(new.email, ''), '@', 1), 'Player');
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
