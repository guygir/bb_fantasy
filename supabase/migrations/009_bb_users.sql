-- BBAPI users: maps bbapi_login to auth.users for BBAPI-based login

CREATE TABLE IF NOT EXISTS bb_users (
  bbapi_login TEXT PRIMARY KEY,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bb_users_auth_user ON bb_users(auth_user_id);

ALTER TABLE bb_users ENABLE ROW LEVEL SECURITY;

-- Only service role manages (no anon access)
CREATE POLICY "Service role manages bb_users"
  ON bb_users FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
