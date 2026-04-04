-- Fix inflated pair stats caused by all games in a room sharing the same game_id.
-- Each real game's rows share the same played_at (inserted in one batch),
-- so game_id || '_' || played_at is unique per actual game.
-- New games use UUIDs and won't be affected by this pattern.

UPDATE game_records
SET game_id = game_id || '_' || CAST(played_at AS TEXT)
WHERE LENGTH(game_id) <= 8;  -- room codes are 4 chars; UUIDs are 36

UPDATE elo_history
SET game_id = game_id || '_' || CAST(played_at AS TEXT)
WHERE LENGTH(game_id) <= 8;
