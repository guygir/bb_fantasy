-- Add previous_price for price change arrows (gray → black).
-- Sync script populates from player_prices_s{N}.json history.
ALTER TABLE fantasy_player_prices ADD COLUMN IF NOT EXISTS previous_price INTEGER;
