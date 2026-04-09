-- League III: promotion band size + bot-league count on snapshot; champ flag on entries

ALTER TABLE promotions_snapshots ADD COLUMN IF NOT EXISTS promotion_band_size INTEGER;
ALTER TABLE promotions_snapshots ADD COLUMN IF NOT EXISTS num_bot_leagues INTEGER;

ALTER TABLE promotions_entries ADD COLUMN IF NOT EXISTS is_champ TEXT NOT NULL DEFAULT 'No';

ALTER TABLE promotions_entries DROP CONSTRAINT IF EXISTS promotions_entries_is_champ_check;
ALTER TABLE promotions_entries ADD CONSTRAINT promotions_entries_is_champ_check
  CHECK (is_champ IN ('Yes', 'No'));
