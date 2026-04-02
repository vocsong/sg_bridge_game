# Telegram Authentication Design

**Date:** 2026-04-02  
**Status:** Approved

## Overview

Add persistent player identity to the Floating Bridge game via Telegram Login Widget. Authenticated users get cross-device identity and will have stats tracked in future. Guests continue to work exactly as before.

## Goals

- Login with Telegram on the website (Login Widget, not Mini App)
- Persistent identity across devices via Telegram user ID
- Customisable display name (defaults to Telegram name, editable)
- Guests can still play without logging in — stats not tracked
- Clean extension point for future OIDC/OAuth providers
- Deploy on Cloudflare Workers free tier

## Non-Goals

- Stats tracking / leaderboards (future work — hook point added but no-op for now)
- Telegram Mini App flow
- Forcing login to play

## Architecture

Stays on Cloudflare Workers + Durable Objects. Cloudflare D1 (SQLite) added for user profiles.

### New files

| File | Purpose |
|------|---------|
| `src/auth.ts` | Telegram Login Widget payload verification, JWT sign/verify |
| `src/db.ts` | D1 queries: upsert user, get profile, update display name |
| `migrations/0001_users.sql` | D1 schema migration |

### Changed files

| File | Changes |
|------|---------|
| `src/index.ts` | Add `/api/auth/telegram`, `/api/me` routes; resolve JWT on WS connect |
| `wrangler.toml` | Add `DB` D1 binding, reference `JWT_SECRET` and `TELEGRAM_BOT_TOKEN` secrets |
| `static/index.html` | Add Telegram Login Widget script, login/guest buttons |
| `static/app.js` | JWT storage in localStorage, pass token on WS connect, pre-fill name from profile |

### Unchanged files

`src/game-room.ts`, `src/bridge.ts`, `src/types.ts`, `src/protocol.ts` — no changes needed.

## D1 Schema

```sql
-- migrations/0001_users.sql
CREATE TABLE users (
  telegram_id   INTEGER PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
```

## New API Endpoints

### `POST /api/auth/telegram`

Verifies Telegram Login Widget payload and returns a JWT.

**Request body:** Raw Telegram auth object  
```json
{
  "id": 123456789,
  "first_name": "Alice",
  "username": "alice",
  "auth_date": 1711234567,
  "hash": "abc123..."
}
```

**Verification steps:**
1. Remove `hash`, sort remaining fields alphabetically, join as `key=value\n`
2. HMAC-SHA256 of that string using `SHA256(TELEGRAM_BOT_TOKEN)` as the key
3. Reject if hash mismatch
4. Reject if `auth_date` older than 24 hours

**Response:**
```json
{ "token": "<jwt>", "displayName": "Alice" }
```

**JWT payload:** `{ sub: "123456789", name: "Alice", exp: <30 days> }`

### `GET /api/me`

Returns the authenticated user's profile. Requires `Authorization: Bearer <jwt>` header.

**Response:**
```json
{ "telegramId": 123456789, "displayName": "Alice" }
```

### `PATCH /api/me`

Updates the authenticated user's display name. Requires `Authorization: Bearer <jwt>` header.

**Request body:**
```json
{ "displayName": "Alice123" }
```

**Response:** `204 No Content`

### `WS /api/ws?room=CODE&playerId=ID&token=JWT`

Existing endpoint. `token` is now optional. If present and valid:
- `playerId` is overridden to `"tg_" + telegram_id` (prefix avoids collision with guest UUIDs)
- Display name pre-filled from D1

If token absent or invalid: falls back to guest behaviour (UUID playerId, no error).

## Identity Resolution in `index.ts`

```
WS connect received
  ├── token present?
  │     ├── valid JWT → playerId = "tg_" + sub, name = profile from D1
  │     └── invalid/expired → treat as guest
  └── no token → playerId = query param UUID, name from join message
  
Delegate to Durable Object stub (unchanged interface)
```

`game-room.ts` receives the same `playerId` + `name` regardless of auth method — no changes needed.

## Frontend Changes

### Login flow

1. Home screen shows:
   - Telegram Login Widget button (`<script>` tag from Telegram)
   - "Continue as Guest" link
2. Widget fires JS callback on success → POST to `/api/auth/telegram` → store JWT in `localStorage`
3. On page load: if JWT in `localStorage`, call `/api/me` to pre-fill display name field
4. JWT passed as `token` query param on WebSocket connect

### Guest flow

Unchanged. No token stored, no token sent. Random UUID playerId from `localStorage` as before.

### Name customisation

Display name field pre-filled with Telegram name for authenticated users, editable. On join, if name differs from stored profile, `PATCH /api/me` updates D1.

## Wrangler Config Additions

```toml
[[d1_databases]]
binding = "DB"
database_name = "sg-bridge-users"
database_id = "<id from wrangler d1 create>"

[vars]
# JWT_SECRET and TELEGRAM_BOT_TOKEN set via: wrangler secret put <NAME>
```

## Secrets

Set via `wrangler secret put`:
- `JWT_SECRET` — random 32-byte hex string
- `TELEGRAM_BOT_TOKEN` — from @BotFather (needed even if not running a bot — just for auth verification)

## Future Stats Hook

After game over in `game-room.ts`, a no-op call point is added:
```typescript
// TODO: POST /api/stats when stats tracking is implemented
// await recordGameResult(authenticatedPlayers, result)
```

No implementation now — just the comment marking where it goes.
