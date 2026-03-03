# Supabase Schema (U21dle + BB Fantasy)

Based on Riftle/Holdemle. Run migrations in order in Supabase SQL Editor.

## Migration order

| # | File | Purpose |
|---|------|---------|
| 001 | `001_u21dle_daily.sql` | Legacy: puzzle_date → player_id (deprecated after 002) |
| 002 | `002_u21dle_puzzles.sql` | Puzzles with UUID id; migrates from 001, drops 001 |
| 003 | `003_u21dle_guesses.sql` | User guesses per puzzle (saves in-progress games) |
| 004 | `004_u21dle_user_stats.sql` | Aggregate stats (games, wins, streaks, solved distribution) |
| 005 | `005_profiles.sql` | Profiles + signup trigger |
| 006 | `006_fantasy_user_rosters.sql` | User rosters (replaces localStorage) |
| 007 | `007_fantasy_roster_substitutions.sql` | Substitution audit |
| 008 | `008_fantasy_game_data.sql` | Optional: players, prices, game stats, matches, schedule |
| 009 | `009_bb_users.sql` | BBAPI login → auth.users mapping |
| 018 | `018_fantasy_total_fp.sql` | total_fantasy_points on rosters |
| 019 | `019_fantasy_roster_nickname.sql` | nickname on rosters (denormalized) |
| 020 | `020_profile_nickname_sync_trigger.sql` | auto-sync nickname to rosters on profile update |

## Tables

### u21dle_puzzles
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK; when puzzle replaced, new id = user gets fresh game |
| puzzle_date | DATE | UNIQUE |
| player_id | INTEGER | BuzzerBeater player ID |
| created_at | TIMESTAMPTZ | |

### u21dle_guesses
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → auth.users |
| puzzle_id | UUID | FK → u21dle_puzzles (ON DELETE CASCADE) |
| guess_history | JSONB | Array of {player, feedback} |
| guesses_used | INTEGER | |
| is_solved | BOOLEAN | true when correct or ran out |
| time_taken_seconds | INTEGER | |
| total_score | INTEGER | |
| game_started_at | TIMESTAMPTZ | |
| submitted_at | TIMESTAMPTZ | |
| UNIQUE(user_id, puzzle_id) | | One row per user per puzzle |

### u21dle_user_stats
| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | PK, FK → auth.users |
| total_games | INTEGER | |
| failed_games | INTEGER | |
| current_streak | INTEGER | |
| max_streak | INTEGER | |
| total_score | INTEGER | |
| average_guesses | DECIMAL(5,2) | |
| last_played_date | DATE | |
| solved_distribution | JSONB | e.g. {"1": 5, "2": 3} |
| updated_at | TIMESTAMPTZ | |

### profiles
| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID | PK, FK → auth.users |
| nickname | TEXT | UNIQUE (case-insensitive) |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### fantasy_user_rosters
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → auth.users |
| season | INTEGER | |
| player_ids | INTEGER[] | 5 BuzzerBeater player IDs |
| player_prices | JSONB | {playerId: price} at pickup |
| player_names | JSONB | {playerId: name} |
| picked_at | TIMESTAMPTZ | |
| locked | BOOLEAN | roster locked for season |
| pending_subs | JSONB | {removed_ids, added_ids, effective_match_id} (012) |
| total_fantasy_points | DECIMAL(8,2) | Sum of roster FP; updated by sync (018) |
| nickname | TEXT | Display name; synced from profiles (019) |
| UNIQUE(user_id, season) | | |

### fantasy_roster_substitutions
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK → auth.users |
| season | INTEGER | |
| removed_player_ids | INTEGER[] | |
| added_player_ids | INTEGER[] | |
| removed_prices | JSONB | |
| added_prices | JSONB | |
| created_at | TIMESTAMPTZ | |

### fantasy_game_data (008 – optional)
Replaces JSON when scripts sync to DB: `fantasy_players`, `fantasy_player_details`, `fantasy_player_prices`, `fantasy_player_game_stats`, `fantasy_matches`, `fantasy_schedule`.

## JSON → DB mapping (current)

| JSON file | Table (when using 008) | Notes |
|-----------|------------------------|-------|
| season71_stats.json | fantasy_players | |
| player_details_s71.json | fantasy_player_details | |
| player_prices_s71.json | fantasy_player_prices | current only (one row per player) |
| player_game_stats_s71.json | fantasy_player_game_stats | |
| match_scores_s71.json | fantasy_matches | |
| bbapi_schedule_s71.json | fantasy_schedule | |
| localStorage fantasy_roster_s71 | fantasy_user_rosters | |

## Flow

1. **Load page:** Get current puzzle for today (by puzzle_date). If user has `guesses` row for that puzzle_id → load it. Else → fresh game.
2. **Puzzle replaced:** Old puzzle row deleted, new row with new id. User has no guesses for new id → fresh game.
3. **In-progress:** User plays 5 guesses, game_over=false. Row exists with guess_history, guesses_used. On reload → load from DB.
4. **Stats:** Updated when game ends (is_solved or guesses_used >= max).

## Next steps (app integration)

**U21dle:**
- Cron inserts into `u21dle_puzzles`
- Add auth; save/load guesses from `u21dle_guesses`
- Update `user_stats` on game over

**Fantasy:**
- Add auth; save/load roster from `fantasy_user_rosters` (replace localStorage)
- On substitution: insert into `fantasy_roster_substitutions`, update `fantasy_user_rosters`
- **Done:** `npm run sync-fantasy [season]` populates game data; API routes read Supabase first, JSON fallback
