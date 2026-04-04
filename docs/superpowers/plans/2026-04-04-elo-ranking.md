# ELO Ranking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wins-based leaderboard ranking with a chess.com-style pair ELO system (K-factor 32/<30 games, 16/30+ games, starting ELO 1000).

**Architecture:** ELO is computed from pair team averages after each game end, stored as a single `elo` column on `users`, and recorded per-game in `elo_history`. Group leaderboards filter by group membership but rank by the same global ELO. Leaderboards continue to display wins/games played as context columns.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare D1 (SQLite), Vitest

---

## Task 1: Migration files

**Files:**
- Create: `migrations/0005_add_elo.sql`
- Create: `migrations/0006_stats_reset.sql`

- [ ] **Step 1: Create `migrations/0005_add_elo.sql`**

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

- [ ] **Step 2: Create `migrations/0006_stats_reset.sql`**

```sql
-- Run manually once after deploying 0005_add_elo.sql:
--   wrangler d1 execute sg-bridge-db --file=migrations/0006_stats_reset.sql
UPDATE users SET elo = 1000, wins = 0, games_played = 0;
DELETE FROM elo_history;
DELETE FROM game_records;
DELETE FROM group_stats;
```

- [ ] **Step 3: Commit**

```bash
git add migrations/0005_add_elo.sql migrations/0006_stats_reset.sql
git commit -m "feat: add elo column and elo_history table migration"
```

---

## Task 2: Pure ELO math helper + tests

**Files:**
- Create: `src/elo.ts`
- Create: `src/elo.test.ts`

The pure computation is extracted so it can be tested without a database.

- [ ] **Step 1: Write the failing tests**

Create `src/elo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeEloDeltas } from './elo';

describe('computeEloDeltas', () => {
  it('awards +16 and -16 when teams are equal (K=32)', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1000, gamesPlayed: 5 }, { telegramId: 2, elo: 1000, gamesPlayed: 5 }],
      [{ telegramId: 3, elo: 1000, gamesPlayed: 5 }, { telegramId: 4, elo: 1000, gamesPlayed: 5 }],
      true,
    );
    expect(result.get(1)).toBe(16);
    expect(result.get(2)).toBe(16);
    expect(result.get(3)).toBe(-16);
    expect(result.get(4)).toBe(-16);
  });

  it('awards smaller gain to heavily favoured team that wins', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1200, gamesPlayed: 5 }, { telegramId: 2, elo: 1200, gamesPlayed: 5 }],
      [{ telegramId: 3, elo: 1000, gamesPlayed: 5 }, { telegramId: 4, elo: 1000, gamesPlayed: 5 }],
      true,
    );
    // favoured team wins: smaller positive delta
    expect(result.get(1)!).toBeGreaterThan(0);
    expect(result.get(1)!).toBeLessThan(16);
    // underdog team loses: smaller negative delta
    expect(result.get(3)!).toBeLessThan(0);
    expect(result.get(3)!).toBeGreaterThan(-16);
  });

  it('awards large gain to underdog team that wins', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1000, gamesPlayed: 5 }, { telegramId: 2, elo: 1000, gamesPlayed: 5 }],
      [{ telegramId: 3, elo: 1200, gamesPlayed: 5 }, { telegramId: 4, elo: 1200, gamesPlayed: 5 }],
      true,
    );
    // underdog wins: large positive delta
    expect(result.get(1)!).toBeGreaterThan(16);
    expect(result.get(3)!).toBeLessThan(-16);
  });

  it('uses K=16 for players with 30+ games', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1000, gamesPlayed: 30 }],
      [{ telegramId: 2, elo: 1000, gamesPlayed: 30 }],
      true,
    );
    expect(result.get(1)).toBe(8);
    expect(result.get(2)).toBe(-8);
  });

  it('uses K=32 for players with fewer than 30 games', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1000, gamesPlayed: 29 }],
      [{ telegramId: 2, elo: 1000, gamesPlayed: 29 }],
      true,
    );
    expect(result.get(1)).toBe(16);
    expect(result.get(2)).toBe(-16);
  });

  it('handles solo bidder (team of one)', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1000, gamesPlayed: 5 }],
      [{ telegramId: 2, elo: 1000, gamesPlayed: 5 }, { telegramId: 3, elo: 1000, gamesPlayed: 5 }],
      true,
    );
    expect(result.get(1)).toBe(16);
    expect(result.get(2)).toBe(-16);
    expect(result.get(3)).toBe(-16);
  });

  it('negative delta when team A loses', () => {
    const result = computeEloDeltas(
      [{ telegramId: 1, elo: 1000, gamesPlayed: 5 }, { telegramId: 2, elo: 1000, gamesPlayed: 5 }],
      [{ telegramId: 3, elo: 1000, gamesPlayed: 5 }, { telegramId: 4, elo: 1000, gamesPlayed: 5 }],
      false,
    );
    expect(result.get(1)).toBe(-16);
    expect(result.get(2)).toBe(-16);
    expect(result.get(3)).toBe(16);
    expect(result.get(4)).toBe(16);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm run test -- src/elo.test.ts
```

Expected: FAIL with `Cannot find module './elo'`

- [ ] **Step 3: Create `src/elo.ts`**

```typescript
export interface EloPlayer {
  telegramId: number;
  elo: number;
  gamesPlayed: number;
}

/**
 * Computes ELO deltas for a pair team game.
 * teamA is the bidder team, teamB is the opposition.
 * teamAWon indicates whether teamA won.
 * Returns a Map of telegramId → delta (positive = gain, negative = loss).
 */
export function computeEloDeltas(
  teamA: EloPlayer[],
  teamB: EloPlayer[],
  teamAWon: boolean,
): Map<number, number> {
  const avgA = teamA.reduce((sum, p) => sum + p.elo, 0) / teamA.length;
  const avgB = teamB.reduce((sum, p) => sum + p.elo, 0) / teamB.length;

  const eA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
  const eB = 1 - eA;

  const deltas = new Map<number, number>();

  for (const player of teamA) {
    const k = player.gamesPlayed < 30 ? 32 : 16;
    const score = teamAWon ? 1 : 0;
    deltas.set(player.telegramId, Math.round(k * (score - eA)));
  }

  for (const player of teamB) {
    const k = player.gamesPlayed < 30 ? 32 : 16;
    const score = teamAWon ? 0 : 1;
    deltas.set(player.telegramId, Math.round(k * (score - eB)));
  }

  return deltas;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm run test -- src/elo.test.ts
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/elo.ts src/elo.test.ts
git commit -m "feat: add pure ELO delta computation with tests"
```

---

## Task 3: `recordEloUpdate` in `src/stats-db.ts`

**Files:**
- Modify: `src/stats-db.ts`

- [ ] **Step 1: Add import and `recordEloUpdate` function to `src/stats-db.ts`**

At the top of `src/stats-db.ts`, add the import:

```typescript
import { computeEloDeltas } from './elo';
import type { EloPlayer } from './elo';
```

Then add this function at the bottom of `src/stats-db.ts`:

```typescript
/**
 * Computes pair ELO deltas after a game and updates users.elo + elo_history.
 * Only authenticated players (tg_ IDs) are included. Guests and bots are skipped.
 * All DB writes are batched in a single db.batch() call.
 */
export async function recordEloUpdate(
  db: D1Database,
  gameId: string,
  players: Player[],
  bidderSeat: number,
  partnerSeat: number,
  winnerSeats: number[],
): Promise<void> {
  const authPlayers = players.filter((p) => p.id.startsWith('tg_'));
  if (authPlayers.length < 2) return;

  const telegramIds = authPlayers.map((p) => Number(p.id.slice(3)));
  const placeholders = telegramIds.map(() => '?').join(',');
  const userRows = await db
    .prepare(`SELECT telegram_id, elo, games_played FROM users WHERE telegram_id IN (${placeholders})`)
    .bind(...telegramIds)
    .all<{ telegram_id: number; elo: number; games_played: number }>();

  const userMap = new Map(
    (userRows.results ?? []).map((r) => [r.telegram_id, r]),
  );

  const seatToPlayer = new Map<number, EloPlayer>();
  for (const p of authPlayers) {
    const tgId = Number(p.id.slice(3));
    const row = userMap.get(tgId);
    if (row) seatToPlayer.set(p.seat, { telegramId: tgId, elo: row.elo, gamesPlayed: row.games_played });
  }

  const isSoloBid = bidderSeat === partnerSeat;
  const bidderTeamSeats = isSoloBid ? [bidderSeat] : [bidderSeat, partnerSeat];
  const oppTeamSeats = [0, 1, 2, 3].filter((s) => !bidderTeamSeats.includes(s));

  const teamA = bidderTeamSeats.map((s) => seatToPlayer.get(s)).filter(Boolean) as EloPlayer[];
  const teamB = oppTeamSeats.map((s) => seatToPlayer.get(s)).filter(Boolean) as EloPlayer[];

  if (teamA.length === 0 || teamB.length === 0) return;

  const teamAWon = winnerSeats.includes(bidderSeat);
  const deltas = computeEloDeltas(teamA, teamB, teamAWon);

  const playedAt = Math.floor(Date.now() / 1000);
  const allPlayers = [...teamA, ...teamB];

  const stmts = allPlayers.flatMap((player) => {
    const delta = deltas.get(player.telegramId) ?? 0;
    const newElo = player.elo + delta;
    return [
      db
        .prepare('UPDATE users SET elo = ? WHERE telegram_id = ?')
        .bind(newElo, player.telegramId),
      db
        .prepare(
          `INSERT INTO elo_history (game_id, telegram_id, elo_before, elo_after, delta, played_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(gameId, player.telegramId, player.elo, newElo, delta, playedAt),
    ];
  });

  await db.batch(stmts);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/stats-db.ts src/elo.ts
git commit -m "feat: add recordEloUpdate to stats-db"
```

---

## Task 4: Call `recordEloUpdate` from `src/game-room.ts`

**Files:**
- Modify: `src/game-room.ts` (two call sites, lines ~734 and ~783)

- [ ] **Step 1: Add import at top of `src/game-room.ts`**

Find the existing import line:
```typescript
import { recordGameStats } from './stats-db';
```

Replace with:
```typescript
import { recordGameStats, recordEloUpdate } from './stats-db';
```

- [ ] **Step 2: Add `recordEloUpdate` call after bidder-wins `recordGameStats` (~line 734)**

Find the block ending with:
```typescript
        await recordGameStats(
          (this.env as Env).DB,
          state.roomCode,
          state.groupId,
          state.players,
          bidder,
          partner,
          state.bid,
          state.sets,
          getWinnerSeats(bidder, partner, true),
        );

        await this.saveState(state);
```

Replace with:
```typescript
        await recordGameStats(
          (this.env as Env).DB,
          state.roomCode,
          state.groupId,
          state.players,
          bidder,
          partner,
          state.bid,
          state.sets,
          getWinnerSeats(bidder, partner, true),
        );

        await recordEloUpdate(
          (this.env as Env).DB,
          state.roomCode,
          state.players,
          bidder,
          partner,
          getWinnerSeats(bidder, partner, true),
        );

        await this.saveState(state);
```

- [ ] **Step 3: Add `recordEloUpdate` call after opposition-wins `recordGameStats` (~line 783)**

Find the second block ending with:
```typescript
        await recordGameStats(
          (this.env as Env).DB,
          state.roomCode,
          state.groupId,
          state.players,
          bidder,
          partner,
          state.bid,
          state.sets,
          getWinnerSeats(bidder, partner, false),
        );

        await this.saveState(state);
```

Replace with:
```typescript
        await recordGameStats(
          (this.env as Env).DB,
          state.roomCode,
          state.groupId,
          state.players,
          bidder,
          partner,
          state.bid,
          state.sets,
          getWinnerSeats(bidder, partner, false),
        );

        await recordEloUpdate(
          (this.env as Env).DB,
          state.roomCode,
          state.players,
          bidder,
          partner,
          getWinnerSeats(bidder, partner, false),
        );

        await this.saveState(state);
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/game-room.ts
git commit -m "feat: call recordEloUpdate after each game end"
```

---

## Task 5: Update `getLeaderboard` and `getGroupLeaderboard` in `src/db.ts`

**Files:**
- Modify: `src/db.ts`

- [ ] **Step 1: Update `LeaderboardEntry` and `GroupLeaderboardEntry` interfaces**

Find:
```typescript
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  wins: number;
  gamesPlayed: number;
}
```

Replace with:
```typescript
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  elo: number;
  wins: number;
  gamesPlayed: number;
}
```

Find:
```typescript
export interface GroupLeaderboardEntry {
  rank: number;
  displayName: string;
  wins: number;
  gamesPlayed: number;
}
```

Replace with:
```typescript
export interface GroupLeaderboardEntry {
  rank: number;
  displayName: string;
  elo: number;
  wins: number;
  gamesPlayed: number;
}
```

- [ ] **Step 2: Update `getLeaderboard` query to rank by ELO**

Find the `getLeaderboard` top query:
```typescript
  const topRows = await db
    .prepare(
      `SELECT display_name, wins, games_played,
              RANK() OVER (ORDER BY wins DESC) AS rank
       FROM users
       WHERE games_played > 0
       ORDER BY wins DESC
       LIMIT 5`,
    )
    .all<{ display_name: string; wins: number; games_played: number; rank: number }>();

  const top: LeaderboardEntry[] = (topRows.results ?? []).map((r) => ({
    rank: r.rank,
    displayName: r.display_name,
    wins: r.wins,
    gamesPlayed: r.games_played,
  }));
```

Replace with:
```typescript
  const topRows = await db
    .prepare(
      `SELECT display_name, elo, wins, games_played,
              RANK() OVER (ORDER BY elo DESC) AS rank
       FROM users
       WHERE games_played > 0
       ORDER BY elo DESC
       LIMIT 5`,
    )
    .all<{ display_name: string; elo: number; wins: number; games_played: number; rank: number }>();

  const top: LeaderboardEntry[] = (topRows.results ?? []).map((r) => ({
    rank: r.rank,
    displayName: r.display_name,
    elo: r.elo,
    wins: r.wins,
    gamesPlayed: r.games_played,
  }));
```

- [ ] **Step 3: Update `getLeaderboard` caller-rank query to rank by ELO**

Find the `meRow` query inside `getLeaderboard`:
```typescript
  const meRow = await db
    .prepare(
      `SELECT display_name, wins, games_played,
              (SELECT COUNT(*) + 1 FROM users WHERE wins > u.wins) AS rank
       FROM users u
       WHERE telegram_id = ?`,
    )
    .bind(telegramId)
    .first<{ display_name: string; wins: number; games_played: number; rank: number }>();

  if (!meRow || meRow.games_played === 0) return { top, me: null };

  // Suppress me row if already in top 5 (rank <= 5)
  if (meRow.rank <= 5) return { top, me: null };

  return {
    top,
    me: {
      rank: meRow.rank,
      displayName: meRow.display_name,
      wins: meRow.wins,
      gamesPlayed: meRow.games_played,
      telegramId,
    },
  };
```

Replace with:
```typescript
  const meRow = await db
    .prepare(
      `SELECT display_name, elo, wins, games_played,
              (SELECT COUNT(*) + 1 FROM users WHERE games_played > 0 AND elo > u.elo) AS rank
       FROM users u
       WHERE telegram_id = ?`,
    )
    .bind(telegramId)
    .first<{ display_name: string; elo: number; wins: number; games_played: number; rank: number }>();

  if (!meRow || meRow.games_played === 0) return { top, me: null };

  if (meRow.rank <= 5) return { top, me: null };

  return {
    top,
    me: {
      rank: meRow.rank,
      displayName: meRow.display_name,
      elo: meRow.elo,
      wins: meRow.wins,
      gamesPlayed: meRow.games_played,
      telegramId,
    },
  };
```

- [ ] **Step 4: Update `getGroupLeaderboard` top query to rank by ELO**

Find the top query inside `getGroupLeaderboard`:
```typescript
  const topRows = await db
    .prepare(
      `SELECT u.display_name, gs.wins, gs.games_played,
              RANK() OVER (ORDER BY gs.wins DESC) AS rank
       FROM group_stats gs
       JOIN users u ON u.telegram_id = gs.telegram_id
       WHERE gs.group_id = ? AND gs.games_played > 0
       ORDER BY gs.wins DESC
       LIMIT 5`,
    )
    .bind(groupId)
    .all<{ display_name: string; wins: number; games_played: number; rank: number }>();

  const top: GroupLeaderboardEntry[] = (topRows.results ?? []).map((r) => ({
    rank: r.rank,
    displayName: r.display_name,
    wins: r.wins,
    gamesPlayed: r.games_played,
  }));
```

Replace with:
```typescript
  const topRows = await db
    .prepare(
      `SELECT u.display_name, u.elo, gs.wins, gs.games_played,
              RANK() OVER (ORDER BY u.elo DESC) AS rank
       FROM group_stats gs
       JOIN users u ON u.telegram_id = gs.telegram_id
       WHERE gs.group_id = ? AND gs.games_played > 0
       ORDER BY u.elo DESC
       LIMIT 5`,
    )
    .bind(groupId)
    .all<{ display_name: string; elo: number; wins: number; games_played: number; rank: number }>();

  const top: GroupLeaderboardEntry[] = (topRows.results ?? []).map((r) => ({
    rank: r.rank,
    displayName: r.display_name,
    elo: r.elo,
    wins: r.wins,
    gamesPlayed: r.games_played,
  }));
```

- [ ] **Step 5: Update `getGroupLeaderboard` caller-rank query**

Find the `meRow` query inside `getGroupLeaderboard`:
```typescript
  const meRow = await db
    .prepare(
      `SELECT u.display_name, gs.wins, gs.games_played,
              (SELECT COUNT(*) + 1 FROM group_stats WHERE group_id = ? AND wins > gs.wins) AS rank
       FROM group_stats gs
       JOIN users u ON u.telegram_id = gs.telegram_id
       WHERE gs.group_id = ? AND gs.telegram_id = ?`,
    )
    .bind(groupId, groupId, telegramId)
    .first<{ display_name: string; wins: number; games_played: number; rank: number }>();

  if (!meRow || meRow.games_played === 0) return { top, me: null };
  if (meRow.rank <= 5) return { top, me: null };

  return {
    top,
    me: {
      rank: meRow.rank,
      displayName: meRow.display_name,
      wins: meRow.wins,
      gamesPlayed: meRow.games_played,
      telegramId,
    },
  };
```

Replace with:
```typescript
  const meRow = await db
    .prepare(
      `SELECT u.display_name, u.elo, gs.wins, gs.games_played,
              (SELECT COUNT(*) + 1
               FROM group_stats gs2
               JOIN users u2 ON u2.telegram_id = gs2.telegram_id
               WHERE gs2.group_id = ? AND gs2.games_played > 0 AND u2.elo > u.elo) AS rank
       FROM group_stats gs
       JOIN users u ON u.telegram_id = gs.telegram_id
       WHERE gs.group_id = ? AND gs.telegram_id = ?`,
    )
    .bind(groupId, groupId, telegramId)
    .first<{ display_name: string; elo: number; wins: number; games_played: number; rank: number }>();

  if (!meRow || meRow.games_played === 0) return { top, me: null };
  if (meRow.rank <= 5) return { top, me: null };

  return {
    top,
    me: {
      rank: meRow.rank,
      displayName: meRow.display_name,
      elo: meRow.elo,
      wins: meRow.wins,
      gamesPlayed: meRow.games_played,
      telegramId,
    },
  };
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/db.ts
git commit -m "feat: rank leaderboards by ELO, include elo in response"
```

---

## Task 6: Add ELO to `getPlayerStats` response

**Files:**
- Modify: `src/stats-db.ts`

The stats page players tab needs ELO data. The existing `getPlayerStats` query already joins `users`, so adding `u.elo` is a one-line SQL change.

- [ ] **Step 1: Add `elo` to `PlayerStatRow` interface**

Find:
```typescript
export interface PlayerStatRow {
  telegramId: number;
  displayName: string;
  games: number;
  wins: number;
  winPct: number;
  bidder: { games: number; wins: number; winPct: number };
  partner: { games: number; wins: number; winPct: number };
  opposition: { games: number; wins: number; winPct: number };
  favBidSuit: string | null;
}
```

Replace with:
```typescript
export interface PlayerStatRow {
  telegramId: number;
  displayName: string;
  elo: number;
  games: number;
  wins: number;
  winPct: number;
  bidder: { games: number; wins: number; winPct: number };
  partner: { games: number; wins: number; winPct: number };
  opposition: { games: number; wins: number; winPct: number };
  favBidSuit: string | null;
}
```

- [ ] **Step 2: Add `u.elo` to the SELECT in `getPlayerStats`**

Find the SELECT in `getPlayerStats`:
```typescript
      `SELECT
         u.telegram_id, u.display_name,
         COUNT(*) as games,
```

Replace with:
```typescript
      `SELECT
         u.telegram_id, u.display_name, u.elo,
         COUNT(*) as games,
```

- [ ] **Step 3: Add `elo` to the TypeScript type annotation in `getPlayerStats`**

Find:
```typescript
    .all<{
      telegram_id: number; display_name: string;
      games: number; wins: number; win_pct: number;
```

Replace with:
```typescript
    .all<{
      telegram_id: number; display_name: string; elo: number;
      games: number; wins: number; win_pct: number;
```

- [ ] **Step 4: Add `elo` to the mapped return value in `getPlayerStats`**

Find:
```typescript
  return (main.results ?? []).map((r) => ({
    telegramId: r.telegram_id,
    displayName: r.display_name,
    games: r.games,
```

Replace with:
```typescript
  return (main.results ?? []).map((r) => ({
    telegramId: r.telegram_id,
    displayName: r.display_name,
    elo: r.elo,
    games: r.games,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/stats-db.ts
git commit -m "feat: include elo in getPlayerStats response"
```

---

## Task 7: Update frontend leaderboard display

**Files:**
- Modify: `static/app.js`
- Modify: `static/style.css`

- [ ] **Step 1: Update `renderLeaderboard` in `static/app.js` to show ELO as primary stat**

Find:
```javascript
  let rows = data.top.map((e) =>
    `<div class="lb-row">
      <span class="lb-rank">${medals[e.rank - 1] || '#' + e.rank}</span>
      <span class="lb-name">${esc(e.displayName)}</span>
      <span class="lb-stats">${e.wins}W / ${e.gamesPlayed}G</span>
    </div>`
  ).join('');
  if (data.me) {
    rows += `<div class="lb-divider"></div>
    <div class="lb-row lb-me">
      <span class="lb-rank">#${data.me.rank}</span>
      <span class="lb-name">You</span>
      <span class="lb-stats">${data.me.wins}W / ${data.me.gamesPlayed}G</span>
    </div>`;
  }
```

Replace with:
```javascript
  let rows = data.top.map((e) =>
    `<div class="lb-row">
      <span class="lb-rank">${medals[e.rank - 1] || '#' + e.rank}</span>
      <span class="lb-name">${esc(e.displayName)}</span>
      <span class="lb-elo">${e.elo}</span>
      <span class="lb-stats">${e.wins}W / ${e.gamesPlayed}G</span>
    </div>`
  ).join('');
  if (data.me) {
    rows += `<div class="lb-divider"></div>
    <div class="lb-row lb-me">
      <span class="lb-rank">#${data.me.rank}</span>
      <span class="lb-name">You</span>
      <span class="lb-elo">${data.me.elo}</span>
      <span class="lb-stats">${data.me.wins}W / ${data.me.gamesPlayed}G</span>
    </div>`;
  }
```

- [ ] **Step 2: Update `renderGroupLeaderboard` in `static/app.js` to show ELO**

Find (both occurrences inside `renderGroupLeaderboard`):
```javascript
      <span class="lb-stats">${e.wins}W / ${e.gamesPlayed}G</span>
```
and
```javascript
      <span class="lb-stats">${data.me.wins}W / ${data.me.gamesPlayed}G</span>
```

In `renderGroupLeaderboard`, replace the rows building block:
```javascript
    let rows = data.top.map((e) =>
      `<div class="lb-row">
        <span class="lb-rank">${medals[e.rank - 1] || '#' + e.rank}</span>
        <span class="lb-name">${esc(e.displayName)}</span>
        <span class="lb-stats">${e.wins}W / ${e.gamesPlayed}G</span>
      </div>`
    ).join('');
    if (data.me) {
      rows += `<div class="lb-divider"></div>
      <div class="lb-row lb-me">
        <span class="lb-rank">#${data.me.rank}</span>
        <span class="lb-name">You</span>
        <span class="lb-stats">${data.me.wins}W / ${data.me.gamesPlayed}G</span>
      </div>`;
    }
```

Replace with:
```javascript
    let rows = data.top.map((e) =>
      `<div class="lb-row">
        <span class="lb-rank">${medals[e.rank - 1] || '#' + e.rank}</span>
        <span class="lb-name">${esc(e.displayName)}</span>
        <span class="lb-elo">${e.elo}</span>
        <span class="lb-stats">${e.wins}W / ${e.gamesPlayed}G</span>
      </div>`
    ).join('');
    if (data.me) {
      rows += `<div class="lb-divider"></div>
      <div class="lb-row lb-me">
        <span class="lb-rank">#${data.me.rank}</span>
        <span class="lb-name">You</span>
        <span class="lb-elo">${data.me.elo}</span>
        <span class="lb-stats">${data.me.wins}W / ${data.me.gamesPlayed}G</span>
      </div>`;
    }
```

- [ ] **Step 3: Add `.lb-elo` style in `static/style.css`**

Add this new rule anywhere in `static/style.css` (e.g. after the `.lb-stats` block):

```css
.lb-elo {
  font-weight: 700;
  color: #d4a843;
  min-width: 3.5rem;
  text-align: right;
}
```

- [ ] **Step 4: Verify layout looks correct locally**

```bash
npm run dev
```

Open browser at the local dev URL. Check home screen leaderboard — each row should show: rank · name · ELO (gold) · W/GP (muted).

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: show ELO as primary stat in leaderboard UI"
```

---

## Task 8: Update stats page players tab

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Change default sort to ELO in `showStats`**

Find:
```javascript
  statsSort = { col: 'winPct', dir: 'desc' };
```

Replace with:
```javascript
  statsSort = { col: 'elo', dir: 'desc' };
```

- [ ] **Step 2: Add `elo` to sort functions and table in `renderPlayersTab`**

Find the `sortFns` object in `renderPlayersTab`:
```javascript
  const sortFns = {
    winPct:           (r) => r.winPct,
    games:            (r) => r.games,
    bidderWinPct:     (r) => r.bidder.winPct,
    partnerWinPct:    (r) => r.partner.winPct,
    oppositionWinPct: (r) => r.opposition.winPct,
    name:             (r) => r.displayName.toLowerCase(),
  };
```

Replace with:
```javascript
  const sortFns = {
    elo:              (r) => r.elo,
    winPct:           (r) => r.winPct,
    games:            (r) => r.games,
    bidderWinPct:     (r) => r.bidder.winPct,
    partnerWinPct:    (r) => r.partner.winPct,
    oppositionWinPct: (r) => r.opposition.winPct,
    name:             (r) => r.displayName.toLowerCase(),
  };
```

- [ ] **Step 3: Add ELO column header and cell to the table**

Find the table body row in `renderPlayersTab`:
```javascript
  const bodyRows = sorted.map((r, i) => {
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    return `<tr>
      <td class="stats-td-name">${medal} ${esc(r.displayName)}</td>
      <td class="stats-td-num">${r.games}</td>
      <td class="stats-td-num">${fmtPct(r.winPct, r.games)}</td>
      <td class="stats-td-num">${fmtPct(r.bidder.winPct, r.bidder.games)}</td>
      <td class="stats-td-num">${fmtPct(r.partner.winPct, r.partner.games)}</td>
      <td class="stats-td-num">${fmtPct(r.opposition.winPct, r.opposition.games)}</td>
      <td class="stats-td-num">${r.favBidSuit ? esc(r.favBidSuit) : '<span class="stats-na">—</span>'}</td>
    </tr>`;
  }).join('');

  content.innerHTML = `<div class="stats-table-wrap"><table class="stats-table">
    <thead><tr>
      ${th('name', 'Player', true)}
      ${th('games', 'G', false)}
      ${th('winPct', 'Win%', false)}
      ${th('bidderWinPct', 'Bid%', false)}
      ${th('partnerWinPct', 'Ptnr%', false)}
      ${th('oppositionWinPct', 'Def%', false)}
      <th>Suit</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;
```

Replace with:
```javascript
  const bodyRows = sorted.map((r, i) => {
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    return `<tr>
      <td class="stats-td-name">${medal} ${esc(r.displayName)}</td>
      <td class="stats-td-num stats-elo">${r.elo}</td>
      <td class="stats-td-num">${r.games}</td>
      <td class="stats-td-num">${fmtPct(r.winPct, r.games)}</td>
      <td class="stats-td-num">${fmtPct(r.bidder.winPct, r.bidder.games)}</td>
      <td class="stats-td-num">${fmtPct(r.partner.winPct, r.partner.games)}</td>
      <td class="stats-td-num">${fmtPct(r.opposition.winPct, r.opposition.games)}</td>
      <td class="stats-td-num">${r.favBidSuit ? esc(r.favBidSuit) : '<span class="stats-na">—</span>'}</td>
    </tr>`;
  }).join('');

  content.innerHTML = `<div class="stats-table-wrap"><table class="stats-table">
    <thead><tr>
      ${th('name', 'Player', true)}
      ${th('elo', 'ELO', false)}
      ${th('games', 'G', false)}
      ${th('winPct', 'Win%', false)}
      ${th('bidderWinPct', 'Bid%', false)}
      ${th('partnerWinPct', 'Ptnr%', false)}
      ${th('oppositionWinPct', 'Def%', false)}
      <th>Suit</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;
```

- [ ] **Step 4: Add `.stats-elo` style in `static/style.css`**

Add this new rule anywhere in `static/style.css`:

```css
.stats-elo {
  color: #d4a843;
  font-weight: 600;
}
```

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: add ELO column to stats page players tab"
```

---

## Task 9: Update Telegram `/leaderboard` command

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update the leaderboard message format to include ELO**

Find in `src/index.ts`:
```typescript
          const rows = data.top
            .map((e) => `${medals[e.rank - 1] ?? `${e.rank}.`} ${e.displayName} — ${e.wins}W / ${e.gamesPlayed}G`)
            .join('\n');
```

Replace with:
```typescript
          const rows = data.top
            .map((e) => `${medals[e.rank - 1] ?? `${e.rank}.`} ${e.displayName} — ELO ${e.elo} (${e.wins}W / ${e.gamesPlayed}G)`)
            .join('\n');
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: include ELO in Telegram leaderboard command output"
```

---

## Task 10: Run full test suite and deploy migration

- [ ] **Step 1: Run all tests**

```bash
npm run test
```

Expected: All tests pass (at minimum the 7 ELO unit tests from Task 2)

- [ ] **Step 2: Type-check the full project**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 3: Apply ELO migration to production D1**

```bash
wrangler d1 migrations apply sg-bridge-db --remote
```

Expected: Migration `0005_add_elo` applied successfully

- [ ] **Step 4: Deploy**

```bash
npm run deploy
```

- [ ] **Step 5: Apply stats reset migration**

```bash
wrangler d1 execute sg-bridge-db --remote --file=migrations/0006_stats_reset.sql
```

Expected: Command succeeds, all player stats zeroed, ELO reset to 1000

- [ ] **Step 6: Verify leaderboard in browser**

Open the game home screen. Leaderboard should show ELO ratings (all 1000 until games are played).
