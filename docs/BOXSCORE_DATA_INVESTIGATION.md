# Boxscore Data Investigation: Scraping vs BBAPI

## Summary

| Method | Auth Required | Per-Game Stats | Match IDs | Recommendation |
|--------|---------------|----------------|------------|----------------|
| **Web scraping (boxscore)** | Yes (login wall) | Yes | From standings | Use if logged-in scraping possible |
| **BBAPI boxscore.aspx** | Yes (BBAPI login) | Yes | matchid param | **Best for automation** |
| **BBAPI schedule.aspx** | Yes | No (scores only) | Yes (in XML) | Use to get match IDs |
| **Stats page (season)** | No | No (averages only) | N/A | Use for initial pricing |

---

## 1. Web Scraping

### 1.1 Stats Page (Public)
- **URL**: `https://buzzerbeater.com/country/15/jnt/stats.aspx?season=70`
- **Auth**: None – publicly accessible
- **Data**: Season averages per player (GP, MIN, FG, 3FG, FT, OR, TR, AST, TO, STL, BLK, PF, PTS, RTNG)
- **Limitation**: Averages only – no per-game variance for formula validation

### 1.2 Schedule Page (Public)
- **URL**: `https://buzzerbeater.com/country/15/jnt/schedule.aspx?season=70`
- **Auth**: None
- **Data**: Match dates, opponents, location, type (SC/SF/F)
- **Limitation**: No match IDs in visible table

### 1.3 Boxscore Page (Login Wall)
- **URL**: `https://buzzerbeater.com/match/{matchId}/boxscore.aspx`
- **Test**: Fetched `match/83641` (Israel 86 – Argentina 53, Season 71)
- **Result**: Returns login/signup page, not boxscore content
- **Conclusion**: Boxscore requires authenticated session (cookie)

### 1.4 Standings Page (Public) – Match IDs
- **URL**: `https://buzzerbeater.com/world/standings.aspx?teamid=1015`
- **Auth**: None
- **Data**: Recent matches with **Box Score** links: `match/83640`, `match/83641`, etc.
- **Use**: Parse this page to get match IDs for Israel U21 games
- **Note**: Shows current season (71) by default; `?season=70` may show Europe Championship (different structure)

---

## 2. BBAPI

### 2.1 Authentication
- **URL**: `http://bbapi.buzzerbeater.com/login.aspx`
- **Params**: `login`, `code` (read-only password from BB account settings)
- **Returns**: Auth cookie for subsequent requests
- **Required**: BuzzerBeater account with API access enabled

### 2.2 schedule.aspx
- **URL**: `http://bbapi.buzzerbeater.com/schedule.aspx`
- **Params**: `teamid=1015`, `season=70`
- **Returns**: XML with all matches, scores, and **match IDs**
- **Use**: Primary source for match IDs when using BBAPI

### 2.3 boxscore.aspx
- **URL**: `http://bbapi.buzzerbeater.com/boxscore.aspx`
- **Params**: `matchid={id}`
- **Returns**: XML with full boxscore – team strategies, player performances (MIN, FG, 3FG, FT, OR, TR, AST, TO, STL, BLK, PF, PTS, RTNG, +/-)
- **Errors**: `BoxscoreNotAvailable` if match not finished; `UnknownMatchID` if invalid

### 2.4 roster.aspx / teamstats.aspx
- **roster.aspx**: `teamid=1015` – player list
- **teamstats.aspx**: `teamid=1015`, `season=70` – season stats (averages or totals)
- **Note**: BBAPI uses `teamid`; Israel U21 = 1015 (from standings URL)

---

## 3. Match ID Discovery

### Option A: Standings Page (Scraping)
1. Fetch `standings.aspx?teamid=1015`
2. Parse "Recent Matches" section for `match/XXXXX/boxscore.aspx` links
3. Extract match IDs
4. **Limitation**: Only recent matches; historical may require different standings view

### Option B: BBAPI schedule.aspx
1. Login to BBAPI
2. Call `schedule.aspx?teamid=1015&season=70`
3. Parse XML for match elements with match IDs
4. **Advantage**: Full season, structured data

### Option C: NT Games Page
- **URL**: `https://buzzerbeater.com/community/ntmatches.aspx`
- May list national team matches with links – not yet tested

---

## 4. Recommended Approach

### Phase 1 (Now): Season Averages
- Use `data/season70_stats.json` (from stats page)
- Run scoring formula on averages as proxy for per-game
- Good enough for initial formula tuning and pricing tiers

### Phase 2 (When Ready): Per-Game Data
1. **If you have BB account**: Use BBAPI
   - Login → schedule.aspx (match IDs) → boxscore.aspx (per match)
   - Store in Supabase for historical analysis
2. **If no BB account**: 
   - Create free account, enable read-only API code
   - Or: Manual entry of a few boxscores from browser (logged in) for validation

### Phase 3 (Production): Automated Ingestion
- Cron job: After each U21 game day
- Fetch standings or schedule for new match IDs
- Fetch boxscores via BBAPI (or logged-in scraper)
- Insert into `player_game_stats`

---

## 5. Known Match IDs (Season 71 – World Cup)

From standings page:
- 83640: Hong Kong 89 – Magyarország 78
- 83641: Argentina 53 – **Israel 86**
- 83642: United States 112 – Ghana 67
- 83643: Deutschland 115 – Lietuva 104
- 83668, 83669, 83670, 83671: Pool B games

---

## 6. BB Insider Tool

From forum search: [BB Insider](https://www.buzzerbeater.com/community/forum/read.aspx?m=1&thread=318389) extends BBAPI with play-by-play and additional match stats. May be useful for advanced analysis; not required for fantasy scoring.
