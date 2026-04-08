-- Link to BuzzerBeater team page (scraped from standings)

ALTER TABLE promotions_entries ADD COLUMN IF NOT EXISTS team_url TEXT;
