# Israel U21 Fantasy - Task List

Track progress here. Check off items as completed.

---

## Phase 1: Data & Scoring Foundation

### 1.1 Data Collection
- [x] **1.1.1** Create data directory structure (`/data`, `/scripts`)
- [x] **1.1.2** Roster: BBAPI roster returns UnknownTeamID for NT; use stats page + player.aspx per player
- [x] **1.1.3** Schedule: BBAPI schedule.aspx + JSON fallback (src/lib/schedule.ts)
- [x] **1.1.4** Build HTML parser for stats page (season averages) – use season70_stats.json
- [x] **1.1.5** Boxscore: BBAPI boxscore.aspx; script fetch-bbapi-boxscore.mjs
- [x] **1.1.6** Collect match IDs – BBAPI schedule.aspx returns them
- [x] **1.1.7** Fetch boxscores – BBAPI boxscore.aspx works; script: fetch-bbapi-boxscore.mjs
- [x] **1.1.8** Document: BBAPI vs scraping – see docs/BOXSCORE_DATA_INVESTIGATION.md

### 1.2 Scoring Formula
- [x] **1.2.1** Implement `statsToFantasyPoints(stats)` in src/lib/scoring.ts
- [x] **1.2.2** Run formula on Season 70 averages (validate-scoring.mjs)
- [x] **1.2.3** Analyze: fantasy points vs RTNG – see lessons.md
- [x] **1.2.4** Analyze: fantasy points distribution (min 5.9, max 34.2, avg 17.6)
- [ ] **1.2.5** Tune formula if needed (optional; tweak as we go)
- [x] **1.2.6** Document formula in PLAN.md

### 1.3 Pricing Design
- [x] **1.3.1** Compute average fantasy PPG per player (Season 70)
- [x] **1.3.2** Design $1–$10 mapping (tiers in fantasyPPGToPrice)
- [x] **1.3.3** Price distribution – see lessons.md
- [x] **1.3.4** Implement `fantasyPPGToPrice(ppg)` in src/lib/scoring.ts
- [x] **1.3.5** Design weekly price adjustment algorithm (min 2 games, confidence ±1/±2)
- [x] **1.3.6** Document in lessons.md

### 1.4 Lessons Update
- [x] **1.4.1** Fill "Data & Sources" section
- [x] **1.4.2** Fill "Scoring Formula" validation results
- [x] **1.4.3** Fill "Pricing" insights

---

## Phase 2: Core App (No Auth)

### 2.1 Project Setup
- [x] **2.1.1** Initialize Next.js project
- [x] **2.1.2** Set up Supabase project
- [x] **2.1.3** Define database schema – see docs/SUPABASE_SCHEMA.md
- [x] **2.1.4** Migrations 001–008: U21dle + fantasy_user_rosters + optional game_data
- [ ] **2.1.5** Add TypeScript types for entities

### 2.2 Data Layer
- [x] **2.2.1** Seed: season70_stats.json, season71_stats.json
- [x] **2.2.2** Schedule: getSchedule() with BBAPI + JSON fallback
- [x] **2.2.3** Boxscore: fetch-bbapi-boxscore.mjs; boxscore XML in data/
- [x] **2.2.4** Initial prices from fantasyPPGToPrice
- [x] **2.2.5** get players: getPlayersWithDetails(season) in src/lib/players.ts
- [x] **2.2.6** get schedule: getSchedule(season) in src/lib/schedule.ts
- [x] **2.2.7** Boxscore parser: src/lib/boxscore.ts, npm run process-boxscores

### 2.3 Scoring & Pricing Logic
- [x] **2.3.1** Fantasy points: computed in boxscore parser (statsToFantasyPoints)
- [x] **2.3.2** Price adjustment: npm run update-prices (max ±$1/week)
- [x] **2.3.3** Price history: data/player_prices_s71.json (current + history)

### 2.4 UI (Read-Only)
- [x] **2.4.1** Page: Home (/) + Players (/players) with name, pos, DMI, salary, $, PTS, RTNG
- [x] **2.4.5** Player faces: fetch-player-face.mjs (face-only crop, ball hidden, cache busting)
- [x] **2.4.2** Page: Schedule (/schedule) – BBAPI + JSON fallback
- [x] **2.4.3** Page: Leaderboard placeholder (/leaderboard)
- [x] **2.4.4** Basic layout/navigation

---

## Phase 3: User Features

### 3.1 Authentication
- [x] **3.1.1** BBAPI-based auth (Supabase Auth + bb_users table)
- [x] **3.1.2** Login / signup flow – /login, validates BBAPI, magic link
- [ ] **3.1.3** Protected routes (optional; pick/roster work for anon via localStorage)
- [x] **3.1.4** User profile (display name from bbapi_login, profiles table)

### 3.2 Draft
- [x] **3.2.1** Draft rules: pick 5 players, $30 cap (no formal draft order)
- [x] **3.2.2** Pick Team UI: /pick – select players, save to localStorage (demo)
- [ ] **3.2.3** Draft state: Supabase user_rosters (deferred)
- [ ] **3.2.4** Draft completion: lock roster for season

### 3.3 Roster & Subs
- [x] **3.3.1** Page: My Roster (/roster) – picks from localStorage, total fantasy points
- [ ] **3.3.2** Substitution flow: remove up to 2, add up to 2, enforce cap
- [ ] **3.3.3** Sub lock: before first game of week
- [ ] **3.3.4** Sub history / audit log

### 3.4 Scoring & Leaderboard
- [x] **3.4.1** Score: roster FP = sum of player_game_stats.fantasyPoints for roster players
- [x] **3.4.2** Page: Leaderboard – top fantasy scorers (players) + link to Pick Team
- [ ] **3.4.3** Page: My scores (weekly history) – defer

---

## Phase 4: Polish & Deploy

### 4.1 Data Ingestion
- [ ] **4.1.1** Cron or manual: fetch new matches after game day
- [ ] **4.1.2** Cron or manual: fetch boxscores for finished matches
- [ ] **4.1.3** Cron: weekly price adjustment
- [ ] **4.1.4** Handle new players (call-ups): `npm run sync-roster-faces` – fetches faces for new roster players only

### 4.2 Deployment
- [ ] **4.2.1** Vercel project setup
- [ ] **4.2.2** Supabase production config
- [ ] **4.2.3** Environment variables
- [ ] **4.2.4** Deploy and smoke test

### 4.4 U21dle (Wordle for Israel U21)

**Reference:** Rift/Riftle (search, feedback, stats, leaderboard, cron) and Cursor_Holdemle (daily puzzle, scoring).

**Data (done):** `data/u21dle_players.json` – playerId, name, gp, pts, age, height, potential, trophies. Run `npm run fetch-u21dle-data`.

#### 4.4.1 Data & Config
- [x] **4.4.1a** fetch-u21dle-data.mjs – seasons 60–70, BBAPI, weighted GP/PTS, trophies, height cm
- [x] **4.4.1b** lib/u21dle/config.ts – MAX_GUESSES (6), PUZZLE_BUFFER_DAYS, EXCLUDE_RECENT_DAYS
- [x] **4.4.1c** lib/u21dle/feedback.ts – generateFeedback(guessed, actual) for GP, PTS, Age, Height, Potential, Trophies (all numeric: exact/high/low)

#### 4.4.2 Game Page & Flow
- [x] **4.4.2a** Add U21dle tab to nav – `/u21dle` (like Riftle in Rif-Trade)
- [x] **4.4.2b** app/u21dle/page.tsx – main game UI
- [x] **4.4.2c** Search box: autocomplete over u21dle_players.json (min 2 chars, debounced)
- [x] **4.4.2d** API GET /api/u21dle/players?q= – search players by name
- [x] **4.4.2e** Guess flow: select player → submit → generateFeedback client-side → show feedback grid (GP, PTS, Age, Height, Potential, Trophies)
- [x] **4.4.2f** Feedback UI: exact=green, high=orange+↓, low=blue+↑ (like Riftle numeric)
- [x] **4.4.2g** Win condition: guessed playerId === daily playerId
- [x] **4.4.2h** Timer, share button (emoji grid), tutorial (intro + feedback)

#### 4.4.3 Daily Puzzle
- [x] **4.4.3a** Deterministic daily player: hash(date) % eligiblePlayers → player index (or random with exclude-recent)
- [x] **4.4.3b** Eligible: GP > 10 (or configurable min)
- [x] **4.4.3c** API GET /api/u21dle/daily – returns puzzle date + player (client compares locally)
- [x] **4.4.3d** Store daily puzzle: JSON file `data/u21dle_daily.json` (date → playerId) or Supabase when ready

#### 4.4.4 Stats & Leaderboard
- [ ] **4.4.4a** Stats: totalGames, wins, winPercent, currentStreak, maxStreak, solvedDistribution, averageGuesses
- [ ] **4.4.4b** API GET /api/u21dle/stats – requires auth (or localStorage for anonymous)
- [ ] **4.4.4c** Leaderboard: daily (today’s puzzle), all-time (wins, win%, avg guesses)
- [ ] **4.4.4d** API GET /api/u21dle/leaderboard?type=daily|alltime-wins|...
- [ ] **4.4.4e** Daily plays chart (optional, like RiftleDailyPlaysChart)

#### 4.4.5 Persistence (JSON-first, Supabase later)
- [x] **4.4.5a** Phase A: localStorage for guesses + stats (anonymous play, no leaderboard)
- [ ] **4.4.5b** Phase B: Supabase daily_players, guesses, user_stats when auth exists
- [ ] **4.4.5c** Migration: u21dle_players → Supabase players table; daily_players for puzzle

#### 4.4.6 Cron & Puzzle Generation
- [x] **4.4.6a** Script: scripts/generate-u21dle-daily.mjs – pick player for date, write to data/u21dle_daily.json
- [x] **4.4.6b** Cron: GitHub Actions – runs script, commits u21dle_daily.json, pushes (Vercel auto-deploys)
- [x] **4.4.6c** Schedule: 00:05 UTC daily
- [x] **4.4.6d** Generate today + PUZZLE_BUFFER_DAYS ahead

#### 4.4.7 Integration
- [x] **4.4.7a** Add U21dle link to home page and nav (alongside Players, Schedule, etc.)
- [x] **4.4.7b** Player face in guess result (reuse PlayerAvatar if face exists)

**U21dle architecture (from Riftle/Holdemle):**
- U21dle uses same auth as BB Fantasy (BBAPI/Supabase when added)
- Feedback: 6 numeric stats → exact/high/low each
- Daily puzzle: one player per date, deterministic or random (exclude recent)
- Anonymous play OK; stats/leaderboard need auth (or localStorage fallback)
- Share: emoji grid (🟩 exact, 🟧 high, 🟦 low)

### 4.5 UX
- [x] **4.5.1** Responsive design (mobile-friendly tables, nav)
- [x] **4.5.2** Loading states, error handling
- [x] **4.5.3** Help / rules page

---

## Blocked / Deferred

- ~~**Supabase & Vercel**~~: ✅ Done – Supabase project, Vercel deploy, GitHub secrets/vars
- **BBAPI**: ✅ Working – login, schedule, boxscore tested with PotatoJunior creds

### Deferral reasons (each deferred item)

| Item | Reason |
|------|--------|
| **1.2.5** Tune formula | Optional; current formula validated on Season 70; can tweak later if needed |
| ~~**1.3.5** Weekly price adjustment algorithm~~ | Done: min 2 games, confidence ±1/±2 |
| ~~**2.1.2** Supabase~~ | ✅ Done – project created, env vars in Vercel |
| **3.1.1–3.1.4** Auth | Depends on Supabase; demo uses localStorage; no sign-up until backend ready |
| **3.2.3** Draft state (Supabase) | Depends on Supabase; localStorage works for single-user demo |
| **3.2.4** Draft lock | Needs season/schedule awareness; defer until we have weekly game logic |
| **3.3.2** Substitution flow | Needs auth + roster in DB; localStorage demo has no subs |
| **3.3.3** Sub lock | Needs schedule (first game of week); defer with subs |
| **3.3.4** Sub history | Depends on subs + DB |
| **3.4.3** My scores (weekly history) | Needs weekly aggregation; single-game total works for now |
| **4.1.1–4.1.4** Data ingestion cron | Defer until deploy; manual scripts work for dev |
| ~~**4.2.1–4.2.4** Vercel + Supabase deploy~~ | ✅ Done – Vercel, Supabase, GitHub repo + secrets |
| **4.5.1–4.5.3** UX polish | After core features; responsive, loading, help page |

---

## Quick Reference

| Phase | Focus | Depends On |
|-------|-------|------------|
| 1 | Data, scoring, pricing | None |
| 2 | App shell, data layer | Phase 1 |
| 3 | Users, draft, subs | Phase 2 |
| 4 | Deploy, automation | Phase 3 |
