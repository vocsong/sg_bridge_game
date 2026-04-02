# Leaderboard Design

**Date:** 2026-04-02  
**Status:** Approved

## Overview

Add a persistent leaderboard to the home screen showing the top 5 players by wins. Stats (wins + games played) are recorded at game end for authenticated players. Guests are not tracked. The leaderboard is publicly visible — no login required to view it.

## Goals

- Display top 5 players (wins + games played) above the login section on the home screen
- Show the logged-in player's own rank below the top 5 if they're not already in it
- Record stats for authenticated players (`tg_` prefixed IDs) after every game
- Guests (UUID player IDs) are silently skipped — no stats recorded

## Non-Goals

- Per-role stats (bidder win rate, defender win rate)
- Win streaks, recent form, game history
- Pagination or full leaderboard view
- Guest stats

## Architecture

Stats stored as two extra columns on the existing `users` D1 table. A new `src/stats.ts` module handles the recording logic, keeping `game-room.ts` focused. A new `GET /api/leaderboard` route serves the data. Frontend fetches it on page load and renders above the login section.

## Database

**Migration: `migrations/0002_stats.sql`**
```sql
ALTER TABLE users ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0;
```

## Stats Recording

**`src/stats.ts`** — exported function:
```typescript
export async function recordGameResult(
  db: D1Database,
  players: Player[],       // from game state
  winnerSeats: number[],   // seats of the winning team (2 players)
): Promise<void>
```

Called from `game-room.ts` after each `gameOver` broadcast (replacing the existing TODO comment). For each player:
- Skip if `player.id` does not start with `'tg_'` (guest)
- Extract `telegramId = Number(player.id.slice(3))`
- Run:
  ```sql
  UPDATE users
  SET games_played = games_played + 1,
      wins = wins + ?
  WHERE telegram_id = ?
  ```
  Where `wins + ?` is `1` if `player.seat` is in `winnerSeats`, else `0`.

**Winner seat calculation** (in `game-room.ts`):**
- If `bidderWon`: winners are `[bidderSeat, partnerSeat]`
- If `!bidderWon`: winners are the two seats that are neither bidder nor partner

When bidder === partner (called their own card): bidder wins alone — `winnerSeats = [bidderSeat]`, only that player gets a win.

## API

### `GET /api/leaderboard`

Public — no auth required. Optional `Authorization: Bearer <jwt>` to include caller's rank.

**Response:**
```json
{
  "top": [
    { "rank": 1, "displayName": "Alice", "wins": 42, "gamesPlayed": 60 },
    { "rank": 2, "displayName": "Bob",   "wins": 38, "gamesPlayed": 55 },
    { "rank": 3, "displayName": "Carol", "wins": 31, "gamesPlayed": 40 },
    { "rank": 4, "displayName": "Dan",   "wins": 29, "gamesPlayed": 38 },
    { "rank": 5, "displayName": "Eve",   "wins": 24, "gamesPlayed": 30 }
  ],
  "me": { "rank": 47, "displayName": "You", "wins": 12, "gamesPlayed": 18 }
}
```

`me` is `null` when:
- No valid JWT provided
- Authenticated user has 0 games played
- Authenticated user is already in the top 5

**D1 queries in `src/db.ts`** — `getLeaderboard(db, telegramId?)`:

```sql
-- Top 5 (only players with at least 1 game)
SELECT display_name, wins, games_played,
       RANK() OVER (ORDER BY wins DESC) AS rank
FROM users
WHERE games_played > 0
ORDER BY wins DESC
LIMIT 5;

-- Caller rank (only run if authenticated and not in top 5)
SELECT COUNT(*) + 1 AS rank
FROM users
WHERE wins > (SELECT wins FROM users WHERE telegram_id = ?);
```

## Frontend

### `static/index.html`

Add `<div id="leaderboard-section"></div>` as the first child inside `#screen-home > .home-container`, before `#login-section`.

### `static/app.js`

On page load (before `initAuth()`), fetch the leaderboard:

```javascript
async function loadLeaderboard() {
  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetch('/api/leaderboard', { headers });
    if (!res.ok) return;
    const data = await res.json();
    renderLeaderboard(data);
  } catch { /* silent fail — leaderboard is non-critical */ }
}
```

`renderLeaderboard(data)` builds into `#leaderboard-section`:
- Trophy header: "🏆 Leaderboard"
- Table rows: rank · name · wins · games played
- If `data.me` is not null: a divider `···` row then the player's own row highlighted

`loadLeaderboard()` is also called after `window.onTelegramAuth` succeeds and after logout (to refresh the "me" row).

### `static/style.css`

New styles for `#leaderboard-section`: dark card matching `.home-container` glassmorphism, gold rank numbers (`#d4a843`), compact rows, subtle divider before the "me" row.

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `migrations/0002_stats.sql` | Add wins/games_played columns |
| Create | `src/stats.ts` | `recordGameResult` helper |
| Modify | `src/db.ts` | Add `getLeaderboard` query |
| Modify | `src/index.ts` | Add `GET /api/leaderboard` route |
| Modify | `src/game-room.ts` | Call `recordGameResult`, replace TODO comment |
| Modify | `static/index.html` | Add `#leaderboard-section` div |
| Modify | `static/app.js` | `loadLeaderboard` + `renderLeaderboard` |
| Modify | `static/style.css` | Leaderboard styles |
