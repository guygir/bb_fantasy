# U21dle Supabase Setup

## 1. Run migrations

In Supabase Dashboard → SQL Editor, run each file in order:

1. `001_u21dle_daily.sql` → `002_u21dle_puzzles.sql` → `003_u21dle_guesses.sql` → `004_u21dle_user_stats.sql` → `005_profiles.sql`
2. Fantasy: `006_fantasy_user_rosters.sql` → `007_fantasy_roster_substitutions.sql`
3. Optional: `008_fantasy_game_data.sql` (players, prices, stats, matches, schedule)
4. Auth: `009_bb_users.sql` (BBAPI login mapping)

See `docs/SUPABASE_SCHEMA.md` and `docs/AUTH_SETUP.md`.

## Fantasy data sync (after 008)

To populate fantasy tables so the app uses Supabase instead of JSON:

```bash
npm run sync-fantasy 71
```

Run after `fetch-player-details`, `process-boxscores`, `update-prices`. Re-run after any data refresh.

## 2. Seed existing data (optional)

If you have `data/u21dle_daily.json` with existing puzzles:

```bash
npm run seed-u21dle-daily
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

## 3. Vercel env vars (required for live site)

Add to your Vercel project → Settings → Environment Variables:

- `NEXT_PUBLIC_SUPABASE_URL` – your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` – anon/public key (from Supabase → Settings → API)

Without these, the app falls back to `data/u21dle_daily.json` (stale data from the repo). **Redeploy** after adding.

## 4. GitHub Actions secrets

Add to Repository secrets:

- `NEXT_PUBLIC_SUPABASE_URL` – your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` – service role key (from Supabase → Settings → API)

## 5. Cron behavior

- **Schedule:** Runs daily at 00:05 UTC
- **Manual:** Actions → U21dle Daily → Run workflow
  - Optional `date` input: specific date (YYYY-MM-DD), or leave empty for today + 3-day buffer
- **Never overwrites:** Existing dates in Supabase are skipped
