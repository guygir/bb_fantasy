# Data Directory

## Season Stats (averages)
- **season70_stats.json**, **season71_stats.json** – Season averages per player (GP, MIN, FG, PTS, RTNG, etc.)
- **Source**: https://buzzerbeater.com/country/15/jnt/stats.aspx?season=N

## Schedule
- **bbapi_schedule_s71.json** – Cached schedule from BBAPI. Run `npm run fetch-schedule 71` to refresh.
- **match_scores_s71.json** – Match scores from parsed boxscores. Populated by `npm run process-boxscores 71`.

## Boxscore (per-game)
- **bbapi_boxscore_83641.xml** – Raw boxscore XML from BBAPI. Run `npm run fetch-boxscore <matchId>` per match.
- **player_game_stats_s71.json** – Parsed per-game stats + fantasy points. Run `npm run process-boxscores 71`.

## Prices
- **player_prices_s71.json** – Current prices + history. Run `npm run update-prices 71` after process-boxscores.

## Player details (position, DMI, salary)
- **player_details_s71.json** – BBAPI player.aspx data. Run `npm run fetch-player-details 71` to refresh.

## U21dle (Wordle game)
- **u21dle_players.json** – Israel U21 players from seasons 60–70 (playerId, name, gp, pts, age, height, potential). Run `npm run fetch-u21dle-data` to refresh.

## Player faces
- **public/player-faces/{playerId}.png** – BuzzerBeater login uses **reCAPTCHA**, so automated Puppeteer login is blocked. Options: (1) Manual screenshots, (2) Cookie export from a logged-in browser session (advanced), (3) Use initial-letter fallback (current default).

## Workflow
1. `npm run fetch-schedule 71` – fetch schedule
2. `npm run fetch-boxscore 83641` – fetch each finished match (repeat for all match IDs)
3. `npm run process-boxscores 71` – parse boxscores → player_game_stats + match_scores
4. `npm run update-prices 71` – compute prices from stats

## Validation
Run `npm run validate-scoring` to test the scoring formula on season70 data.
