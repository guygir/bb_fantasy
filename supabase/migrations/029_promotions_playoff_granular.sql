-- Update playoff_status constraint to support granular round-based statuses
-- (In Quarters, In Semis, In Finals, Champ, Lost Finals, Lost Semis, Lost Quarters, Not in playoff)

ALTER TABLE promotions_entries DROP CONSTRAINT IF EXISTS promotions_entries_playoff_status_check;

ALTER TABLE promotions_entries ADD CONSTRAINT promotions_entries_playoff_status_check
  CHECK (playoff_status IN (
    'Champ',
    'In Quarters',
    'In Semis',
    'In Finals',
    'Lost Finals',
    'Lost Semis',
    'Lost Quarters',
    'Not in playoff',
    'In playoff',
    'Out of playoff'
  ));
