# ELO Ranking System Design

**Date:** 2026-04-04  
**Status:** Approved

## Overview

Replace the current wins-based leaderboard ranking with a pair ELO system modelled on chess.com's rating system. Players start at 1000 ELO. Rankings on both the home leaderboard and the group leaderboard use ELO as the primary sort; wins and games played are shown as context. A stats reset is run once after deploy to give everyone a clean start.

## Goals

- Rank players by ELO rating instead of raw wins
- Compute ELO using pair team variant: bidder+partner vs opposition pair
- Dynamic K-factor (K=32 for <30 games, K=16 for 30+ games)
- Single global ELO per player — group leaderboard filters by group membership, ranks by same ELO
- Persist ELO history per game for future rating-graph features
- Stats reset migration to wipe all historical data after deploy

## Non-Goals

- Per-group ELO ratings
- ELO history graph UI (foundation laid, not implemented now)
- Rating floors/ceilings
- Provisional rating period beyond K-factor adjustment

## Database

### Migration: `migrations/0005_add_elo.sql`

```sql
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
```

### Migration: `migrations/0006_stats_reset.sql` *(run manually once after deploy)*

```sql
UPDATE users SET elo = 1000, wins = 0, games_played = 0;
DELETE FROM elo_history;
DELETE FROM game_records;
DELETE FROM group_stats;
```

Run with:
```bash
wrangler d1 execute sg-bridge-db --file=migrations/0006_stats_reset.sql
```

## ELO Calculation

Implemented as `recordEloUpdate` in `src/stats-db.ts`, called from `game-room.ts` alongside the existing `recordGameStats` call.

### Team assignment

- **Bidder team:** [bidderSeat, partnerSeat]. If solo bid (bidder === partner), bidder is a team of one.
- **Opposition team:** remaining seats.

### Formula

```
avg_A = mean ELO of authenticated players on team A
avg_B = mean ELO of authenticated players on team B

E_A = 1 / (1 + 10^((avg_B - avg_A) / 400))
E_B = 1 - E_A

For each authenticated player i on winning team:
  delta_i = round(K_i × (1 - E_winning))

For each authenticated player i on losing team:
  delta_i = round(K_i × (0 - E_losing))   -- negative value

K_i = 32 if games_played < 30, else 16
```

Guest and bot players (non `tg_` IDs) are excluded from team averages and receive no ELO update.

### D1 batch

All 4 ELO updates to `users.elo` and 4 inserts into `elo_history` are executed in a single `db.batch()` call — no partial updates on failure.

## API Changes

### `GET /api/leaderboard`

No route change. Updated response shape:

```json
{
  "top": [
    { "rank": 1, "displayName": "Alice", "elo": 1187, "wins": 42, "gamesPlayed": 60 },
    { "rank": 2, "displayName": "Bob",   "elo": 1143, "wins": 38, "gamesPlayed": 55 }
  ],
  "me": { "rank": 12, "displayName": "You", "elo": 1034, "wins": 12, "gamesPlayed": 18 }
}
```

### `src/db.ts` — `getLeaderboard`

- `ORDER BY wins DESC` → `ORDER BY elo DESC`
- Rank window function and caller-rank subquery updated to use `elo`
- `LeaderboardEntry` interface: add `elo: number`

### `src/db.ts` — `getGroupLeaderboard`

Same changes, scoped to `group_stats` members joined to `users.elo`.

## Frontend

### Leaderboard card (`static/app.js` + `static/style.css`)

- Primary stat: ELO rating (large, gold)
- Secondary: `W: 42 / 60 GP` in smaller muted text
- Rank column unchanged

### Stats page players tab (`static/app.js`)

- Add ELO column, sort by ELO descending by default (replaces win% default sort)

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `migrations/0005_add_elo.sql` | Add `elo` column, create `elo_history` table |
| Create | `migrations/0006_stats_reset.sql` | Reset all stats (manual, run once post-deploy) |
| Modify | `src/stats-db.ts` | Add `recordEloUpdate` function |
| Modify | `src/game-room.ts` | Call `recordEloUpdate` after game end |
| Modify | `src/db.ts` | Rank by ELO in `getLeaderboard` / `getGroupLeaderboard`; update `LeaderboardEntry` |
| Modify | `static/app.js` | Show ELO in leaderboard card + stats page players tab |
| Modify | `static/style.css` | Style ELO display in leaderboard card |
