# BBAPI Auth Setup

## 1. Run migration

```sql
-- From supabase/migrations/009_bb_users.sql
CREATE TABLE IF NOT EXISTS bb_users (
  bbapi_login TEXT PRIMARY KEY,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ... (run full migration)
```

## 2. Supabase Auth URL Configuration

In Supabase Dashboard → Authentication → URL Configuration:

- **Site URL:** Your production URL (e.g. `https://bb-fantasy.vercel.app`)
- **Redirect URLs:** Add:
  - `http://localhost:3000`
  - `http://localhost:3000/**`
  - `https://your-vercel-url.vercel.app/**`

## 3. Flow

1. User goes to `/login`, enters BBAPI login + code
2. API validates against BBAPI
3. If invalid → show error
4. If valid → create/find Supabase auth user, generate magic link
5. Client redirects to magic link → user is signed in
6. Session persists (Supabase handles refresh)

## 4. First-time vs returning

- **First time:** Creates `auth.users` entry, `bb_users` row, `profiles` row (via trigger)
- **Returning:** Finds `bb_users` by login, generates magic link for existing user
