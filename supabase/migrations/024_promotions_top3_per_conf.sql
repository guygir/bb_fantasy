-- Allow up to 120 ranked entries (20 leagues × 6 teams: top 3 per conference × 2)

ALTER TABLE promotions_entries DROP CONSTRAINT IF EXISTS promotions_entries_display_rank_check;

ALTER TABLE promotions_entries ADD CONSTRAINT promotions_entries_display_rank_check
  CHECK (display_rank >= 1 AND display_rank <= 200);
