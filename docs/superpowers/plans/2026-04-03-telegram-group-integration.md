# Telegram Group Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a Telegram bot to create game rooms from a group chat via `/newgame`, post game events back into the group, and maintain a per-group leaderboard scoped to verified group members.

**Architecture:** A new `src/telegram.ts` module centralises all Telegram Bot API calls (sendMessage, isChatMember, parseUpdate). `src/index.ts` gains a `POST /api/telegram` webhook handler. `game-room.ts` imports telegram helpers to check membership on join and post notifications on game events.

**Tech Stack:** Cloudflare Workers, Durable Objects, D1 (SQLite), Telegram Bot API (REST)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `migrations/0003_groups.sql` | Create | `groups` and `group_stats` tables |
| `src/telegram.ts` | Create | `sendMessage`, `isChatMember`, `parseUpdate` |
| `src/types.ts` | Modify | Add `groupId`, `isGroupMember` to GameState / Player / PlayerGameView |
| `src/db.ts` | Modify | Add `upsertGroup`, `recordGroupResult`, `getGroupLeaderboard` |
| `src/index.ts` | Modify | `POST /api/telegram`, update `GET /api/leaderboard`, update `POST /api/create` |
| `src/game-room.ts` | Modify | groupId on state, membership check on join, notifications, group stats on gameover |
| `static/index.html` | Modify | Add group leaderboard container on gameover screen |
| `static/app.js` | Modify | Not-ranked badge in lobby, group leaderboard on gameover |
| `static/style.css` | Modify | Not-ranked badge style |

---

### Task 1: D1 migration — groups and group_stats tables

**Files:**
- Create: `migrations/0003_groups.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/0003_groups.sql
CREATE TABLE IF NOT EXISTS groups (
  group_id   TEXT    PRIMARY KEY,
  group_name TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_stats (
  group_id     TEXT    NOT NULL,
  telegram_id  INTEGER NOT NULL,
  wins         INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, telegram_id),
  FOREIGN KEY (group_id) REFERENCES groups(group_id)
);
```

- [ ] **Step 2: Apply migration locally**

```bash
npx wrangler d1 execute DB --local --file=migrations/0003_groups.sql
```
Expected: no errors, migration applied.

- [ ] **Step 3: Apply migration to production**

```bash
npx wrangler d1 execute DB --remote --file=migrations/0003_groups.sql
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/0003_groups.sql
git commit -m "feat: add groups and group_stats D1 tables"
```

---

### Task 2: src/telegram.ts — Telegram API helper module

**Files:**
- Create: `src/telegram.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/telegram.ts
const TG_API = 'https://api.telegram.org';

/**
 * Post a plain-text message to a Telegram chat.
 * Fire-and-forget — errors are swallowed (notifications are non-critical).
 */
export async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch {
    // swallow — never block game flow on a failed notification
  }
}

/**
 * Check if a Telegram user is a member of a chat.
 * Returns false on any error (fail-safe: unknown = non-member).
 */
export async function isChatMember(
  token: string,
  chatId: string,
  userId: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    if (!res.ok) return false;
    const data = await res.json<{ ok: boolean; result?: { status: string } }>();
    if (!data.ok || !data.result) return false;
    return ['member', 'administrator', 'creator'].includes(data.result.status);
  } catch {
    return false;
  }
}

export interface TelegramCommand {
  command: 'newgame' | 'leaderboard';
  chatId: string;
  groupName: string;
  fromUserId: number;
  fromUsername: string;
}

/**
 * Parse a Telegram Update payload.
 * Returns null for non-group messages, non-commands, or unsupported commands.
 */
export function parseUpdate(body: unknown): TelegramCommand | null {
  try {
    const update = body as {
      message?: {
        chat?: { id: number; type: string; title?: string };
        from?: { id: number; username?: string; first_name?: string };
        text?: string;
      };
    };
    const msg = update?.message;
    if (!msg) return null;

    const chat = msg.chat;
    if (!chat || !['group', 'supergroup'].includes(chat.type)) return null;

    const text = msg.text?.trim() ?? '';
    if (!text.startsWith('/')) return null;

    // Strip bot mention: /newgame@BotName → newgame
    const cmdRaw = text.split(' ')[0].split('@')[0].slice(1).toLowerCase();
    if (cmdRaw !== 'newgame' && cmdRaw !== 'leaderboard') return null;

    const from = msg.from;
    if (!from) return null;

    return {
      command: cmdRaw as 'newgame' | 'leaderboard',
      chatId: String(chat.id),
      groupName: chat.title ?? 'Group',
      fromUserId: from.id,
      fromUsername: from.username ?? from.first_name ?? String(from.id),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/telegram.ts
git commit -m "feat: add telegram.ts helper (sendMessage, isChatMember, parseUpdate)"
```

---

### Task 3: src/types.ts — add groupId and isGroupMember

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `isGroupMember` to Player**

Find the `Player` interface and add the field:

```typescript
export interface Player {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  wins?: number;
  gamesPlayed?: number;
  isBot?: boolean;
  isGroupMember?: boolean;   // add this line
}
```

- [ ] **Step 2: Add `groupId` to GameState**

Find the `GameState` interface and add after `firstBidder`:

```typescript
  firstBidder: number;
  groupId: string | null;    // add this line
```

- [ ] **Step 3: Add `groupId` and `isGroupMember` to PlayerGameView**

Find the `PlayerGameView` interface. Update the `players` array type and add two fields:

```typescript
export interface PlayerGameView {
  roomCode: string;
  phase: GamePhase;
  players: { name: string; seat: number; connected: boolean; wins?: number; gamesPlayed?: number; isBot?: boolean; isGroupMember?: boolean }[];
  hand: Hand | null;
  turn: number;
  bidder: number;
  bid: number;
  trumpSuit: BidSuit | null;
  setsNeeded: number;
  sets: number[];
  trumpBroken: boolean;
  firstPlayer: number;
  currentSuit: Suit | null;
  playedCards: (string | null)[];
  partnerCard: string | null;
  isPartner: boolean;
  mySeat: number;
  lastTrick: TrickRecord | null;
  trickComplete: boolean;
  bidHistory: BidHistoryEntry[];
  isSpectator: boolean;
  watchingSeat: number;
  groupId: string | null;        // add this line
  isGroupMember?: boolean;       // add this line (current player's membership)
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: errors about `groupId` missing in `createInitialState` — these will be fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat: add groupId and isGroupMember to types"
```

---

### Task 4: src/db.ts — upsertGroup, recordGroupResult, getGroupLeaderboard

**Files:**
- Modify: `src/db.ts`

- [ ] **Step 1: Add imports and `upsertGroup`**

At the end of `src/db.ts`, add:

```typescript
/**
 * Insert or replace a group record.
 */
export async function upsertGroup(
  db: D1Database,
  groupId: string,
  groupName: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT OR REPLACE INTO groups (group_id, group_name, created_at) VALUES (?, ?, ?)',
    )
    .bind(groupId, groupName, Math.floor(Date.now() / 1000))
    .run();
}
```

- [ ] **Step 2: Add `recordGroupResult`**

Add after `upsertGroup`. Note the import of `Player` from types is already present at the top of db.ts via `import type { Player } from './types'` — add this import if it isn't there.

```typescript
import type { Player } from './types';  // add at top if not present

/**
 * Update group_stats for verified group members after a game ends.
 * Skips guests (non-tg_ IDs) and non-members (isGroupMember !== true).
 */
export async function recordGroupResult(
  db: D1Database,
  groupId: string,
  players: Player[],
  winnerSeats: number[],
): Promise<void> {
  await Promise.all(
    players.map((player) => {
      if (!player.id.startsWith('tg_')) return Promise.resolve();
      if (!player.isGroupMember) return Promise.resolve();
      const telegramId = Number(player.id.slice(3));
      const won = winnerSeats.includes(player.seat) ? 1 : 0;
      return db
        .prepare(
          `INSERT INTO group_stats (group_id, telegram_id, wins, games_played)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(group_id, telegram_id) DO UPDATE SET
             games_played = games_played + 1,
             wins = wins + ?`,
        )
        .bind(groupId, telegramId, won, won)
        .run();
    }),
  );
}
```

- [ ] **Step 3: Add `getGroupLeaderboard`**

```typescript
export interface GroupLeaderboardEntry {
  rank: number;
  displayName: string;
  wins: number;
  gamesPlayed: number;
}

/**
 * Returns top 5 players by wins in this group + optionally the caller's rank.
 */
export async function getGroupLeaderboard(
  db: D1Database,
  groupId: string,
  telegramId?: number,
): Promise<{ top: GroupLeaderboardEntry[]; me: (GroupLeaderboardEntry & { telegramId: number }) | null }> {
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

  if (!telegramId) return { top, me: null };

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
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts
git commit -m "feat: add upsertGroup, recordGroupResult, getGroupLeaderboard to db.ts"
```

---

### Task 5: src/index.ts — webhook handler, leaderboard update, create update

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update imports at the top of src/index.ts**

```typescript
import type { Env } from './types';
import { verifyTelegramAuth, signJwt, verifyJwt } from './auth';
import { upsertUser, getUser, updateDisplayName, getLeaderboard, upsertGroup, getGroupLeaderboard } from './db';
import { sendMessage, parseUpdate } from './telegram';
```

- [ ] **Step 2: Update `POST /api/create` to accept optional groupId**

Replace the existing `/api/create` handler:

```typescript
if (url.pathname === '/api/create' && request.method === 'POST') {
  const body = await request.json<{ groupId?: string | null }>().catch(() => ({}));
  const roomCode = generateRoomCode();
  const stub = env.GAME_ROOM.getByName(roomCode);
  await stub.fetch(
    new Request('https://internal/create', {
      method: 'POST',
      body: JSON.stringify({ roomCode, groupId: body.groupId ?? null }),
    }),
  );
  return Response.json({ roomCode });
}
```

- [ ] **Step 3: Update `GET /api/leaderboard` to support groupId param**

Replace the existing leaderboard handler:

```typescript
if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
  const claims = await getAuthClaims(request, env.JWT_SECRET).catch(() => null);
  const telegramId = claims ? Number(claims.sub) : undefined;
  const groupId = url.searchParams.get('groupId');

  if (groupId) {
    const data = await getGroupLeaderboard(env.DB, groupId, telegramId);
    return Response.json(data);
  }

  const data = await getLeaderboard(env.DB, telegramId);
  return Response.json(data);
}
```

- [ ] **Step 4: Add `POST /api/telegram` webhook handler**

Add this block before the final `return new Response(null, { status: 404 })`:

```typescript
if (url.pathname === '/api/telegram' && request.method === 'POST') {
  // Always respond 200 immediately — Telegram retries on non-200
  const body = await request.json().catch(() => null);
  const origin = new URL(request.url).origin;

  const cmd = parseUpdate(body);
  if (!cmd) return new Response(null, { status: 200 });

  if (cmd.command === 'newgame') {
    await upsertGroup(env.DB, cmd.chatId, cmd.groupName);
    const roomCode = generateRoomCode();
    const stub = env.GAME_ROOM.getByName(roomCode);
    await stub.fetch(
      new Request('https://internal/create', {
        method: 'POST',
        body: JSON.stringify({ roomCode, groupId: cmd.chatId }),
      }),
    );
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      cmd.chatId,
      `🃏 <b>@${cmd.fromUsername}</b> started a new game!\nJoin → ${origin}/#${roomCode}`,
    );
  }

  if (cmd.command === 'leaderboard') {
    const data = await getGroupLeaderboard(env.DB, cmd.chatId);
    if (data.top.length === 0) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        cmd.chatId,
        '🏆 No games played in this group yet!',
      );
    } else {
      const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
      const rows = data.top
        .map((e) => `${medals[e.rank - 1] ?? `${e.rank}.`} ${e.displayName} — ${e.wins}W / ${e.gamesPlayed}G`)
        .join('\n');
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        cmd.chatId,
        `🏆 <b>Group Leaderboard</b>\n${rows}`,
      );
    }
  }

  return new Response(null, { status: 200 });
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: add /api/telegram webhook, group leaderboard route, groupId on room create"
```

---

### Task 6: src/game-room.ts — groupId state, membership check, notifications, group stats

**Files:**
- Modify: `src/game-room.ts`

- [ ] **Step 1: Add telegram imports at the top of game-room.ts**

Add after the existing imports:

```typescript
import { sendMessage, isChatMember } from './telegram';
import { recordGroupResult } from './db';
```

Note: `recordGameResult` is already imported from `./stats`. `getBidFromNum` is already imported from `./bridge`.

- [ ] **Step 2: Update /create handler to accept and store groupId**

Replace the existing `/create` handler in the `fetch` method:

```typescript
if (url.pathname === '/create' && request.method === 'POST') {
  const { roomCode, groupId } = (await request.json()) as { roomCode: string; groupId?: string | null };
  const state = this.createInitialState(roomCode, groupId ?? null);
  await this.ctx.storage.put('state', state);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Update createInitialState to accept groupId**

Replace the `createInitialState` method signature and body:

```typescript
private createInitialState(roomCode: string, groupId: string | null = null): GameState {
  return {
    roomCode,
    phase: 'lobby',
    players: [],
    hands: [],
    turn: 0,
    bidder: -1,
    bid: -1,
    trumpSuit: null,
    setsNeeded: -1,
    sets: [0, 0, 0, 0],
    trumpBroken: false,
    firstPlayer: 0,
    currentSuit: null,
    playedCards: [null, null, null, null],
    partner: -1,
    partnerCard: null,
    passCount: 0,
    lastTrick: null,
    trickComplete: false,
    bidHistory: [],
    spectators: [],
    firstBidder: 0,
    groupId,
  };
}
```

- [ ] **Step 4: Update buildStateMessage to expose groupId and isGroupMember**

In `buildStateMessage`, update the `players` map and add two new fields to the view:

```typescript
// In the players map:
players: state.players.map((p) => ({
  name: p.name,
  seat: p.seat,
  connected: p.connected,
  wins: p.wins,
  gamesPlayed: p.gamesPlayed,
  isBot: p.isBot,
  isGroupMember: p.isGroupMember,
})),

// Add these two lines to the view object (alongside isSpectator, watchingSeat):
groupId: state.groupId,
isGroupMember: player?.isGroupMember,
```

- [ ] **Step 5: Add membership check in handleJoin**

In `handleJoin`, after `await this.refreshPlayerStats(newPlayer, playerId)` and before `state.players.push(newPlayer)`, add:

```typescript
// Group membership check
if (state.groupId && playerId.startsWith('tg_')) {
  const telegramId = Number(playerId.slice(3));
  newPlayer.isGroupMember = await isChatMember(
    (this.env as Env).TELEGRAM_BOT_TOKEN,
    state.groupId,
    telegramId,
  );
} else if (state.groupId) {
  // Guest in a group-linked room — not a member
  newPlayer.isGroupMember = false;
}
```

- [ ] **Step 6: Add game-start notification in handleJoin**

In `handleJoin`, inside the `if (state.players.length === NUM_PLAYERS)` block, after the `this.broadcast({ type: 'gameStart', ... })` call:

```typescript
if (state.groupId) {
  const names = state.players.map((p) => p.name).join(', ');
  sendMessage(
    (this.env as Env).TELEGRAM_BOT_TOKEN,
    state.groupId,
    `🎮 Game started!\nPlayers: ${names}`,
  ).catch(() => {});
}
```

Same block also applies in `handleAddBot` when game starts (same pattern — add after the `this.broadcast({ type: 'gameStart', ... })` line).

- [ ] **Step 7: Add bid-won notification in finalizeBidding**

In `finalizeBidding`, after `this.broadcast({ type: 'bidWon', ... })`:

```typescript
if (state.groupId) {
  sendMessage(
    (this.env as Env).TELEGRAM_BOT_TOKEN,
    state.groupId,
    `🔨 ${state.players[state.bidder].name} bid ${getBidFromNum(state.bid)}`,
  ).catch(() => {});
}
```

- [ ] **Step 8: Add game-over notifications and group stats in handlePlayCard**

In `handlePlayCard`, in the **bidder wins** block, after `this.broadcast({ type: 'gameOver', bidderWon: true, ... })` and the existing `recordGameResult` call:

```typescript
if (state.groupId) {
  const bidStr = getBidFromNum(state.bid);
  const tricksMade = state.sets[bidder] + (partner !== bidder ? state.sets[partner] : 0);
  sendMessage(
    (this.env as Env).TELEGRAM_BOT_TOKEN,
    state.groupId,
    `🏆 ${winnerNames.join(' & ')} won!\nBid ${bidStr}, made ${tricksMade}/${state.setsNeeded} tricks`,
  ).catch(() => {});
  await recordGroupResult(
    (this.env as Env).DB,
    state.groupId,
    state.players,
    getWinnerSeats(bidder, partner, true),
  );
}
```

In the **opposition wins** block, after `this.broadcast({ type: 'gameOver', bidderWon: false, ... })` and the existing `recordGameResult` call:

```typescript
if (state.groupId) {
  const bidStr = getBidFromNum(state.bid);
  sendMessage(
    (this.env as Env).TELEGRAM_BOT_TOKEN,
    state.groupId,
    `🛡️ ${winnerNames.join(' & ')} defended!\n${state.players[bidder].name}'s ${bidStr} bid failed`,
  ).catch(() => {});
  await recordGroupResult(
    (this.env as Env).DB,
    state.groupId,
    state.players,
    getWinnerSeats(bidder, partner, false),
  );
}
```

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/game-room.ts
git commit -m "feat: game-room groupId state, membership check, Telegram notifications, group stats"
```

---

### Task 7: Frontend — not-ranked badge and group leaderboard on game-over

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/style.css`

- [ ] **Step 1: Add group leaderboard container to gameover screen in index.html**

Find the `#screen-gameover` div and add a container for the group leaderboard inside `.gameover-container`, after `#gameover-scores`:

```html
<div id="gameover-group-lb"></div>
```

So the gameover container becomes:
```html
<div class="gameover-container">
  <h2 id="gameover-title"></h2>
  <div id="gameover-players" class="player-status-bar"></div>
  <p id="gameover-detail"></p>
  <div id="gameover-scores" class="scores"></div>
  <div id="gameover-group-lb"></div>
  <div class="gameover-actions">
    <button id="btn-play-again" class="btn btn-primary">Play Again</button>
  </div>
</div>
```

- [ ] **Step 2: Add not-ranked badge in renderLobby (app.js)**

In `renderLobby`, inside the player loop, after the `statsHtml` variable declaration, add:

```javascript
const notRankedBadge = (s.groupId && p.isGroupMember === false && !p.isBot)
  ? '<span class="not-ranked-badge">⚠️ not ranked</span>'
  : '';
```

Then include `notRankedBadge` in the `item.innerHTML` line, after `statsHtml`:

```javascript
item.innerHTML = `<span class="seat-num">${p.seat + 1}</span>${statusDot(p.connected)}${botIcon}<span class="lobby-player-name">${esc(p.name)}</span>${statsHtml}${notRankedBadge}${removeBtn}`;
```

- [ ] **Step 3: Add group leaderboard rendering on game-over (app.js)**

Add a new function after `renderLeaderboard`:

```javascript
async function renderGroupLeaderboard(groupId) {
  const el = $('gameover-group-lb');
  if (!el) return;
  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetch(`/api/leaderboard?groupId=${encodeURIComponent(groupId)}`, { headers });
    if (!res.ok) { el.innerHTML = ''; return; }
    const data = await res.json();
    if (!data.top || data.top.length === 0) { el.innerHTML = ''; return; }
    const medals = ['🥇', '🥈', '🥉', '', ''];
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
    el.innerHTML = `<div class="lb-card"><div class="lb-header">🏆 Group Leaderboard</div>${rows}</div>`;
  } catch {
    el.innerHTML = '';
  }
}
```

- [ ] **Step 4: Call renderGroupLeaderboard in renderGameOver (app.js)**

Find the `renderGameOver` function. At the end of the function body, add:

```javascript
const groupLbEl = $('gameover-group-lb');
if (groupLbEl) groupLbEl.innerHTML = '';
if (s.groupId) {
  renderGroupLeaderboard(s.groupId);
}
```

- [ ] **Step 5: Add CSS for not-ranked badge (style.css)**

Add at the end of `style.css`:

```css
/* --- Not-ranked badge (group games) --- */
.not-ranked-badge {
  font-size: 0.65rem;
  font-weight: 600;
  color: rgba(255, 180, 0, 0.8);
  background: rgba(255, 180, 0, 0.1);
  border: 1px solid rgba(255, 180, 0, 0.25);
  border-radius: 10px;
  padding: 0.1rem 0.4rem;
  margin-left: 0.25rem;
  white-space: nowrap;
}
```

- [ ] **Step 6: Commit**

```bash
git add static/index.html static/app.js static/style.css
git commit -m "feat: lobby not-ranked badge and group leaderboard on game-over screen"
```

---

### Task 8: Webhook registration and README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add webhook setup section to README**

Find the Setup or Deployment section in `README.md` and add:

```markdown
### Telegram Webhook Setup

After deploying, register the bot webhook once:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<your-worker-domain>/api/telegram"
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

The bot responds to these commands in group chats:
- `/newgame` — creates a game room and posts a join link
- `/leaderboard` — posts the group's top 5 leaderboard
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Telegram webhook setup instructions to README"
```

---

### Task 9: Push and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin telegram-group-integration
```

- [ ] **Step 2: Open PR on GitHub**

Go to `https://github.com/vocsong/sg_bridge_bot/pull/new/telegram-group-integration`
