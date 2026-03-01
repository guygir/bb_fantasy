# Lessons Learned

A living document to track what worked, what didn't, and validation results. Update as we build and test.

---

## Data & Sources

### What We Know
- [ ] **Roster page**: Requires login for full view? (players.aspx returned error when fetched)
- [x] **Stats page**: Public, shows season averages (GP, MIN, FG, 3FG, FT, OR, TR, AST, TO, STL, BLK, PF, PTS, RTNG)
- [x] **Schedule page**: Public, shows matches with dates; Season 70 had 15 games
- [x] **Boxscore page**: Requires login – returns login wall when fetched without auth
- [x] **BBAPI**: Requires login (login.aspx with code=read-only password); boxscore.aspx needs matchid
- [x] **Standings page**: Public, shows match IDs in "Recent Matches" links (e.g. match/83641)
- [x] **Israel U21 teamid**: 1015 (from standings URL)

### To Verify
- [x] **Match IDs**: Available from standings page (Recent Matches) and BBAPI schedule.aspx
- [ ] BBAPI schedule.aspx with teamid=1015 for full Season 70 match list

---

## Scoring Formula

### Validation Status
- [x] Run formula on Season 70 season averages (proxy for per-game)
- [x] Compare fantasy points distribution vs. RTNG
- [ ] Run on actual per-game data when boxscores available

### Findings (2025-02-25)
| Finding |
|---------|
| Formula run on Season 70 averages: Fantasy PPG range 5.9–34.2, avg 17.6 |
| Ron Alberman (3.9 PTS, 16.2 RTNG): 27.9 fantasy PPG – rebounds/blocks rewarded |
| Price distribution: $3(1), $4(3), $5(3), $6(3), $7(3), $9(5), $10(3) – no $8 |
| May need to adjust price tiers for better $30 cap diversity |

---

## Pricing

### Season 70 Reference (from stats page)
| Player | GP | PTS | RTNG | Notes |
|--------|-----|-----|------|------|
| Doron Fux | 11 | 24.4 | 16.0 | Top scorer |
| Ron Alberman | 12 | 3.9 | 16.2 | High RTNG, low PTS (rebounder?) |
| Niran Yunger | 8 | 11.8 | 16.2 | Efficient |
| Nir Itshaki | 11 | 8.5 | 17.5 | High RTNG |
| ... | | | | |

### Season 71 Reference (current)
| Player | GP | PTS | RTNG |
|--------|-----|-----|------|
| Nir Itshaki | 5 | 18.4 | 17.2 |
| Moran Drukman | 5 | 10.0 | 15.7 |
| Zion Futeran | 3 | 3.3 | 16.6 | Low minutes, high RTNG |
| ... | | | |

### Insights
- RTNG doesn't always correlate with PTS (e.g. Ron Alberman)
- Need per-game data to validate fantasy formula properly

### Weekly Price Adjustment Algorithm (1.3.5)
- **Min games**: 2+ games required to adjust (avoids single-game noise)
- **Confidence scaling**: 5+ games → ±2 max change; 2–4 games → ±1
- **New players**: Use full fantasyPPGToPrice (no cap)

---

## Technical

### What Worked
- [x] BBAPI login with PotatoJunior / 12341234
- [x] roster.aspx teamid=1015 → UnknownTeamID (NT not supported)
- [x] teamstats.aspx teamid=1015 season=71 → empty (NT stats not in BBAPI)
- [x] player.aspx playerid=X → works for position, DMI, salary, gameShape
- [x] Player faces: BuzzerBeater login has reCAPTCHA → blocks Puppeteer. Faces require manual screenshots or cookie-based auth. We use initial fallback.
- [x] Cookie parsing: split on `,\s*(?=[\w.]+=)` to capture both ASP.NET_SessionId and .ASPXAUTH
- [x] schedule.aspx?teamid=1015&season=71 returns Israel U21 matches with match IDs
- [x] boxscore.aspx?matchid=83641 returns full player stats (fgm, fga, pts, etc.)
- [x] Schedule: use JSON fallback when BBAPI returns empty; parse with match-block regex

### What Didn't
- [ ] (to fill)

### Gotchas
- [ ] (to fill)

---

## Game Design

### Decisions Made
- [ ] (to fill as we decide)

### Open Questions
- See DESIGN_QUESTIONS.md
