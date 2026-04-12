-- Replace is_champ (Yes/No) with playoff_status (Champ / In playoff / Out of playoff)

ALTER TABLE promotions_entries ADD COLUMN IF NOT EXISTS playoff_status TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promotions_entries' AND column_name = 'is_champ'
  ) THEN
    UPDATE promotions_entries
    SET playoff_status = CASE WHEN is_champ = 'Yes' THEN 'Champ' ELSE 'Out of playoff' END
    WHERE playoff_status IS NULL;
  END IF;
END $$;

UPDATE promotions_entries SET playoff_status = 'Out of playoff' WHERE playoff_status IS NULL;

ALTER TABLE promotions_entries ALTER COLUMN playoff_status SET DEFAULT 'Out of playoff';
ALTER TABLE promotions_entries ALTER COLUMN playoff_status SET NOT NULL;

ALTER TABLE promotions_entries DROP CONSTRAINT IF EXISTS promotions_entries_is_champ_check;
ALTER TABLE promotions_entries DROP COLUMN IF EXISTS is_champ;

ALTER TABLE promotions_entries DROP CONSTRAINT IF EXISTS promotions_entries_playoff_status_check;

ALTER TABLE promotions_entries ADD CONSTRAINT promotions_entries_playoff_status_check
  CHECK (playoff_status IN ('Champ', 'In playoff', 'Out of playoff'));
