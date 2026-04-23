-- Run manually once after deploying 0005_add_elo.sql:
--   wrangler d1 execute sg-bridge-users --file=migrations/0006_stats_reset.sql
UPDATE users SET elo = 1000, wins = 0, games_played = 0;
DELETE FROM elo_history;
DELETE FROM game_records;
DELETE FROM group_stats;
