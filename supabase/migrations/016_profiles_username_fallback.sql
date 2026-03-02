-- Support both nickname and username: some Supabase setups use username.
-- Add whichever column is missing and sync. Code uses nickname ?? username.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Sync: nickname -> username (if username empty)
UPDATE profiles SET username = nickname WHERE (username IS NULL OR username = '') AND nickname IS NOT NULL;

-- Sync: username -> nickname (if nickname empty, e.g. schema had username only)
UPDATE profiles SET nickname = username WHERE (nickname IS NULL OR nickname = '') AND username IS NOT NULL;
