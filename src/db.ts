import type { D1Database } from '@cloudflare/workers-types';

export interface UserRow {
  telegram_id: number;
  display_name: string;
  created_at: number;
}

/**
 * Insert or update a user record. Updates display_name on conflict.
 */
export async function upsertUser(
  db: D1Database,
  telegramId: number,
  displayName: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (telegram_id, display_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(telegramId, displayName, Math.floor(Date.now() / 1000))
    .run();
}

/**
 * Fetch a user by Telegram ID. Returns null if not found.
 */
export async function getUser(db: D1Database, telegramId: number): Promise<UserRow | null> {
  const row = await db
    .prepare('SELECT telegram_id, display_name, created_at FROM users WHERE telegram_id = ?')
    .bind(telegramId)
    .first<UserRow>();
  return row ?? null;
}

/**
 * Update the display name for an existing user.
 */
export async function updateDisplayName(
  db: D1Database,
  telegramId: number,
  displayName: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET display_name = ? WHERE telegram_id = ?')
    .bind(displayName, telegramId)
    .run();
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  wins: number;
  gamesPlayed: number;
}

/**
 * Returns top 5 players by wins (min 1 game played) + optionally the caller's rank.
 * If telegramId is provided and not in top 5, their rank is returned separately.
 */
export async function getLeaderboard(
  db: D1Database,
  telegramId?: number,
): Promise<{ top: LeaderboardEntry[]; me: (LeaderboardEntry & { telegramId: number }) | null }> {
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

  if (!telegramId) return { top, me: null };

  // Get caller's stats
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
}
