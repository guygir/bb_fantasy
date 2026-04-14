-- Run in Supabase SQL Editor (service role / postgres bypasses RLS).
-- Week N = Nth row in fantasy_schedule for the season ordered by match_date, match_id.
-- If your UI "week 12" is a different game (e.g. eligibility filters), change the filter in `target` to:
--   WHERE fs.match_date = '2026-04-13'::date
-- instead of week_num = 12.

WITH params AS (
  SELECT
    '48c707ed-c070-4864-b64c-dfbf61bd0152'::uuid AS user_id,
    71 AS season,
    12 AS week_num
),
numbered_schedule AS (
  SELECT
    fs.match_id,
    fs.match_date,
    fs.match_start,
    ROW_NUMBER() OVER (ORDER BY fs.match_date ASC, fs.match_id ASC) AS calendar_week_num
  FROM fantasy_schedule fs
  CROSS JOIN params p
  WHERE fs.season = p.season
    AND fs.match_date IS NOT NULL
),
target AS (
  SELECT ns.*
  FROM numbered_schedule ns
  CROSS JOIN params p
  WHERE ns.calendar_week_num = p.week_num
),
rbm AS (
  SELECT r.player_ids
  FROM fantasy_roster_by_match r
  CROSS JOIN params p
  JOIN target t ON t.match_id = r.match_id
  WHERE r.user_id = p.user_id
    AND r.season = p.season
),
ur AS (
  SELECT ur.player_ids, ur.pending_subs, ur.picked_at
  FROM fantasy_user_rosters ur
  CROSS JOIN params p
  WHERE ur.user_id = p.user_id
    AND ur.season = p.season
),
snapshot_rows AS (
  SELECT
    g.player_id,
    COALESCE(g.name, fp.name) AS name,
    g.fantasy_points
  FROM fantasy_player_game_stats g
  CROSS JOIN params p
  JOIN target t ON t.match_id = g.match_id
  LEFT JOIN fantasy_players fp ON fp.season = p.season AND fp.player_id = g.player_id
  CROSS JOIN rbm
  WHERE g.season = p.season
    AND g.player_id = ANY (rbm.player_ids)
),
subs_match AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'created_at', s.created_at,
      'effective_match_id', s.effective_match_id,
      'removed', s.removed_player_ids,
      'added', s.added_player_ids
    ) ORDER BY s.created_at
  ) AS subs_for_this_match
  FROM fantasy_roster_substitutions s
  CROSS JOIN params p
  CROSS JOIN target t
  WHERE s.user_id = p.user_id
    AND s.season = p.season
    AND (
      s.effective_match_id IS NOT NULL AND s.effective_match_id::text = t.match_id::text
    )
),
subs_all AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'created_at', s.created_at,
      'effective_match_id', s.effective_match_id,
      'removed', s.removed_player_ids,
      'added', s.added_player_ids
    ) ORDER BY s.created_at
  ) AS subs_season_chronological
  FROM fantasy_roster_substitutions s
  CROSS JOIN params p
  WHERE s.user_id = p.user_id
    AND s.season = p.season
),
current_roster_fp AS (
  SELECT round(COALESCE(sum(g.fantasy_points), 0)::numeric, 1) AS total_fp
  FROM fantasy_player_game_stats g
  CROSS JOIN params p
  CROSS JOIN target t
  CROSS JOIN ur
  WHERE g.season = p.season
    AND g.match_id = t.match_id
    AND g.player_id = ANY (ur.player_ids)
)
SELECT
  p.week_num,
  t.match_id,
  t.match_date,
  t.match_start,
  rbm.player_ids AS snapshot_player_ids_from_fantasy_roster_by_match,
  (SELECT COALESCE(jsonb_agg(
    jsonb_build_object('player_id', sr.player_id, 'name', sr.name, 'fp', sr.fantasy_points)
    ORDER BY sr.player_id
  ), '[]'::jsonb) FROM snapshot_rows sr) AS snapshot_fp_breakdown_json,
  (SELECT round(COALESCE(sum(sr.fantasy_points), 0)::numeric, 1) FROM snapshot_rows sr) AS snapshot_total_fp,
  crf.total_fp AS current_roster_fp_sum_at_this_match_id,
  ur.player_ids AS current_roster_player_ids,
  ur.pending_subs,
  ur.picked_at,
  sm.subs_for_this_match,
  sa.subs_season_chronological
FROM params p
CROSS JOIN target t
LEFT JOIN rbm ON TRUE
LEFT JOIN ur ON TRUE
LEFT JOIN current_roster_fp crf ON TRUE
LEFT JOIN subs_match sm ON TRUE
LEFT JOIN subs_all sa ON TRUE;
