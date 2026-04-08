-- Separate snapshots per tier: League III (1004–1019) vs League II (1000–1003)

ALTER TABLE promotions_snapshots ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'league3';

ALTER TABLE promotions_snapshots DROP CONSTRAINT IF EXISTS promotions_snapshots_tier_check;
ALTER TABLE promotions_snapshots ADD CONSTRAINT promotions_snapshots_tier_check
  CHECK (tier IN ('league3', 'league2'));

CREATE INDEX IF NOT EXISTS idx_promotions_snapshots_tier_created
  ON promotions_snapshots(tier, created_at DESC);
