# U21dle Supabase Setup

## 1. Run migration

In Supabase Dashboard → SQL Editor, run:

```sql
-- From supabase/migrations/001_u21dle_daily.sql
CREATE TABLE IF NOT EXISTS u21dle_daily (
  puzzle_date DATE PRIMARY KEY,
  player_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE u21dle_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"
  ON u21dle_daily FOR SELECT
  USING (true);
```

## 2. Seed existing data (optional)

If you have `data/u21dle_daily.json` with existing puzzles:

```bash
npm run seed-u21dle-daily
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

## 3. GitHub Actions secrets

Add to Repository secrets:

- `NEXT_PUBLIC_SUPABASE_URL` – your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` – service role key (from Supabase → Settings → API)

## 4. Cron behavior

- **Schedule:** Runs daily at 00:05 UTC
- **Manual:** Actions → U21dle Daily → Run workflow
  - Optional `date` input: specific date (YYYY-MM-DD), or leave empty for today + 3-day buffer
- **Never overwrites:** Existing dates in Supabase are skipped
