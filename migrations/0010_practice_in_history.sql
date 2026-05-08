-- Allow practice games to appear in per-user history.
-- We still keep game_records untouched so leaderboard / ELO / stats queries
-- continue to ignore practice games.

ALTER TABLE game_hands ADD COLUMN telegram_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_game_hands_telegram ON game_hands(telegram_id);

ALTER TABLE game_metadata ADD COLUMN is_practice INTEGER NOT NULL DEFAULT 0;
