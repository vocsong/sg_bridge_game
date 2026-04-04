ALTER TABLE users ADD COLUMN elo INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE elo_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     TEXT    NOT NULL,
  telegram_id INTEGER NOT NULL,
  elo_before  INTEGER NOT NULL,
  elo_after   INTEGER NOT NULL,
  delta       INTEGER NOT NULL,
  played_at   INTEGER NOT NULL
);

CREATE INDEX idx_elo_history_player ON elo_history(telegram_id, played_at DESC);
