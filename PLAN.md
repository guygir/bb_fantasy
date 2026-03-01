# Israel U21 Fantasy - Comprehensive Project Plan

## Executive Summary

A fantasy basketball game based on the Israel U21 National Team from [BuzzerBeater](https://buzzerbeater.com). Users draft a team (max $30 budget), earn points from player game stats, and can make weekly substitutions. Player prices ($1–$10) are adjusted weekly based on performance.

---

## 1. Game Overview

### 1.1 Core Loop
1. **Pre-season**: Users pick a team of U21 players within $30 budget (5 players exactly)
2. **Weekly**: Israel U21 plays 1–2 games; player stats → fantasy points
3. **Post-game**: Users earn points from their roster
4. **Between games**: Up to 2 substitutions (maintaining $30 cap)
5. **Weekly reset**: Player prices may be adjusted based on performance

### 1.2 Data Sources

| Data | Source | Auth Required |
|------|--------|---------------|
| Roster (players) | [buzzerbeater.com/country/15/jnt/players.aspx](https://buzzerbeater.com/country/15/jnt/players.aspx) | No (public) |
| Schedule | [buzzerbeater.com/country/15/jnt/schedule.aspx](https://buzzerbeater.com/country/15/jnt/schedule.aspx) | No |
| Season stats | [buzzerbeater.com/country/15/jnt/stats.aspx](https://buzzerbeater.com/country/15/jnt/stats.aspx) | No |
| Per-game boxscore | [buzzerbeater.com/match/{matchId}/boxscore.aspx](https://buzzerbeater.com/match/83641/boxscore.aspx) | No (public) |
| BBAPI (XML) | bbapi.buzzerbeater.com | Yes (login) |

**Strategy**: Users sign up with their BBAPI credentials; we use their access for data. For development, hardcode: `PotatoJunior` / `12341234`.

### 1.3 Key URLs
- **Israel country ID**: 15
- **Israel U21 team ID** (BBAPI): 1015
- **Season 71** (current): In progress
- **Season 70** (reference): 15 games (incl. scrimmage, qualifiers, SF, Final)

---

## 2. Stats & Scoring Design

### 2.1 Available Stats (per game)
From boxscore / stats pages:

| Stat | Meaning | Typical range (U21) |
|------|---------|---------------------|
| MIN | Minutes played | 0–40 |
| FG | Field goals (made-attempts) | e.g. 5-12 |
| 3FG | 3-pointers (made-attempts) | e.g. 1-4 |
| FT | Free throws (made-attempts) | e.g. 2-4 |
| +/- | Plus/minus | -20 to +20 |
| OR | Offensive rebounds | 0–5 |
| TR | Total rebounds | 0–15 |
| AST | Assists | 0–8 |
| TO | Turnovers | 0–6 |
| STL | Steals | 0–4 |
| BLK | Blocks | 0–4 |
| PF | Personal fouls | 0–5 |
| PTS | Points | 0–30 |
| RTNG | BuzzerBeater rating | 0–25 |

### 2.2 Proposed Fantasy Scoring Formula

**Goal**: Transform raw stats into fantasy points. Better players → more points. Similar production → similar cost (for roster diversity).

**Proposed formula** (to be validated against Season 70 data):

```
FantasyPoints = 
  PTS * 1.0                    (points are primary)
+ (TR - OR) * 1.2              (defensive rebounds)
+ OR * 1.5                     (offensive rebounds - more valuable)
+ AST * 1.5                    (assists)
+ STL * 2.0                    (steals - impactful)
+ BLK * 2.0                    (blocks - impactful)
- TO * 1.0                     (turnovers negative)
- PF * 0.5                     (fouls slight negative)
+ (3FG_made * 0.5)             (bonus for 3s, already in PTS)
```

**Alternative (simpler)**: Use BuzzerBeater's RTNG as base and add small bonuses for stocks (STL, BLK) and subtract for TO.

**Validation needed**: Run this formula on Season 70 per-game data (from boxscores) and check:
- Correlation between fantasy points and RTNG
- Distribution of fantasy points across players
- Whether similar-cost players have similar fantasy output

### 2.3 Player Value ($1–$10) and % Estimation

**Initial pricing** (pre-season):
- Use Season 70 (or prior) season averages
- Map fantasy points per game → $ tier
- Ensure ~5–8 players per $ tier for diversity

**% Estimation** (for display):
- "This player scores X fantasy PPG on average → estimated Y% of roster value"
- Or: "Based on last N games, this player is trending up/down"

**Weekly price adjustment**:
- Compare actual fantasy PPG vs. price tier
- Underpriced: fantasy PPG > expected for $ → consider raising price
- Overpriced: fantasy PPG < expected for $ → consider lowering price
- Cap movement at ±$1 per week to avoid volatility

---

## 3. Technical Architecture

### 3.1 Stack
- **Frontend**: Next.js (or React) on Vercel
- **Backend**: Vercel serverless / API routes
- **Database**: Supabase (PostgreSQL)
- **Data ingestion**: Scraping scripts or BBAPI (cron / manual trigger)

### 3.2 Data Flow
```
BuzzerBeater (web/API) 
    → Ingestion job (fetch roster, schedule, boxscores)
    → Supabase (players, matches, player_game_stats, prices)
    → API / App
    → User (draft, subs, leaderboard)
```

### 3.3 Database Schema (Draft)

```
players
  - id (BB player ID)
  - name
  - bb_player_id
  - current_price (1-10)
  - created_at, updated_at

matches
  - id
  - bb_match_id
  - season
  - game_date
  - home_team_id, away_team_id
  - home_score, away_score
  - is_scrimmage (boolean)
  - created_at

player_game_stats
  - id
  - player_id
  - match_id
  - min, fg_made, fg_att, tp_made, tp_att, ft_made, ft_att
  - or, tr, ast, to, stl, blk, pf, pts, rtng, plus_minus
  - fantasy_points (computed)
  - created_at

player_prices
  - id
  - player_id
  - price (1-10)
  - effective_from (date)
  - created_at

users
  - id
  - email / auth_id
  - display_name
  - created_at

user_rosters
  - id
  - user_id
  - season
  - created_at

user_roster_players
  - id
  - roster_id
  - player_id
  - acquired_at
  - price_at_acquisition (for cap validation)

user_weekly_scores
  - id
  - user_id
  - season
  - week (or match_id)
  - total_fantasy_points
  - created_at
```

---

## 4. Game Rules (To Finalize)

### 4.1 Draft
- [ ] Snake draft vs. auction?
- [ ] Draft order determination
- [ ] Roster size (min/max players)
- [x] $30 cap (tweak as we go)

### 4.2 Scoring
- [ ] Count all U21 games or exclude scrimmages?
- [ ] Count playoff games (SF, F)?
- [ ] DNP (did not play) = 0 points (confirmed)

### 4.3 Substitutions
- [ ] 2 subs per week – calendar week or between games?
- [ ] Lock time: before first game of the week?
- [ ] Can you sub a player who already played this week?

### 4.4 Price Changes
- [ ] How often: weekly, after each game?
- [ ] Max change per update: ±$1?
- [ ] Do user rosters get grandfathered (keep old price) or revalued?

### 4.5 Season
- [ ] Align with BuzzerBeater U21 season (e.g. Season 71)?
- [ ] When does our "season" start/end for fantasy?

---

## 5. Implementation Phases

### Phase 1: Data & Scoring (Foundation)
1. Build scraper/parser for roster, schedule, stats
2. Obtain or simulate per-game boxscore data (Season 70)
3. Implement and validate scoring formula
4. Design initial $1–$10 pricing from historical data
5. Document findings in lessons.md

### Phase 2: Core App (No Auth)
1. Set up Next.js + Supabase
2. Seed players, matches, stats (manual or script)
3. Implement scoring calculation
4. Build: player list, schedule, leaderboard (static)
5. Price adjustment logic (algorithm)

### Phase 3: User Features
1. Auth (Supabase Auth or similar)
2. Draft flow
3. Roster management
4. Substitution flow
5. Weekly score calculation

### Phase 4: Polish & Deploy
1. Vercel deployment
2. Cron for data ingestion (or manual)
3. UI/UX polish
4. Testing with real users

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| BuzzerBeater pages change structure | Use robust selectors; fallback to BBAPI if available |
| BBAPI requires login | Use public scraping first; document BBAPI for future |
| Small player pool (~15) | $30 cap + $1–10 range forces interesting choices |
| Roster changes mid-season | Handle new call-ups; set rules for new players |
| Match IDs hard to get | Parse schedule page for match links; or maintain mapping |

---

## 7. References

- [BBAPI Programmer's Manual](BBAPI_Programmer_Manual.html)
- [BBAPI Docs](https://bbapi.buzzerbeater.com/docs/)
- [Israel U21 Roster](https://buzzerbeater.com/country/15/jnt/players.aspx)
- [Israel U21 Schedule](https://buzzerbeater.com/country/15/jnt/schedule.aspx)
- [Israel U21 Stats](https://buzzerbeater.com/country/15/jnt/stats.aspx)
- [Sample Boxscore](https://buzzerbeater.com/match/83641/boxscore.aspx)
