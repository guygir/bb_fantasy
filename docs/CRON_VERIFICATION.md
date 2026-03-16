# Fantasy Weekly Sync – Verification Guide

## What it does

The `.github/workflows/fantasy-weekly-sync.yml` workflow runs **daily at 02:00 UTC** and:

1. **Fetch U21 roster + stats** – Scrapes stats page, fetches BBAPI details for new players
2. **Fetch player details** – BBAPI player.aspx for all roster players → `player_details_s71.json` (GS, DMI, position, salary)
3. **Fetch schedule** – Gets Israel U21 schedule from BBAPI
4. **Fetch boxscores** – Downloads boxscore XML for all past matches
5. **Process boxscores** – Parses stats → `player_game_stats_s71.json`, `match_scores_s71.json`
6. **Update prices** – Weekly adjustment from stats → `player_prices_s71.json`
7. **Sync to Supabase** – Pushes to `fantasy_player_game_stats`, `fantasy_matches`, `fantasy_player_prices`, `fantasy_player_details`, etc.

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `BBAPI_LOGIN` | BuzzerBeater API login |
| `BBAPI_CODE` | BuzzerBeater API code (read-only password) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

## Manual trigger

1. Go to **Actions** → **Fantasy Weekly Sync**
2. Click **Run workflow**
3. Optionally set **season** (default: 71)

## Verify locally

```bash
npm run fantasy-weekly-sync 71
```

Requires `.env.local` with:
- `BBAPI_LOGIN`, `BBAPI_CODE`
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `CURRENT_SEASON=71`

## What to check after a run

1. **Schedule** – `data/bbapi_schedule_s71.json` has matches
2. **Boxscores** – `data/bbapi_boxscore_*.xml` files for past matches
3. **Stats** – `data/player_game_stats_s71.json` has entries for all games
4. **Supabase** – Roster page shows correct game count; leaderboard has data

## Schedule

- **Cron:** Daily at 02:00 UTC
- **Manual:** `workflow_dispatch` with optional season input

Runs daily; new data appears when a U21 game has been played (typically weekly). Boxscores are fetched only for past matches; price adjustment runs each time (idempotent when no new stats).
