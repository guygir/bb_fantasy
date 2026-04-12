-- Granular playoff_status (round + elimination step). Replaces Champ / In playoff / Out of playoff.

ALTER TABLE promotions_entries DROP CONSTRAINT IF EXISTS promotions_entries_playoff_status_check;

UPDATE promotions_entries SET playoff_status = 'Not in playoff' WHERE playoff_status = 'Out of playoff';
UPDATE promotions_entries SET playoff_status = 'In Quarters' WHERE playoff_status = 'In playoff';

ALTER TABLE promotions_entries ALTER COLUMN playoff_status SET DEFAULT 'Not in playoff';

ALTER TABLE promotions_entries ADD CONSTRAINT promotions_entries_playoff_status_check
  CHECK (playoff_status IN (
    'In Quarters',
    'In Semis',
    'In Finals',
    'Champ',
    'Lost Finals',
    'Lost Semis',
    'Lost Quarters',
    'Not in playoff'
  ));
