# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multiplayer Singaporean Floating Bridge card game running on Cloudflare Workers with Durable Objects for state management and WebSocket for real-time communication.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start local dev server (simulates Durable Objects)
npm run deploy    # Deploy to Cloudflare Workers (requires wrangler login)
npm run typecheck # TypeScript type check without compiling
npm run test      # Run vitest (no tests currently exist)
```

## Architecture

### Backend (Cloudflare Workers + Durable Objects)

- **`src/index.ts`** — Worker entry point. Routes `POST /api/create` (generates room code, provisions DO) and `/api/ws` (upgrades to WebSocket, delegates to DO).
- **`src/game-room.ts`** — The Durable Object. One instance per room. Holds the full `GameState` in DO storage, manages the WebSocket connections for all 4 players, and runs the entire game state machine (lobby → bidding → partner selection → play → game over).
- **`src/bridge.ts`** — Pure game logic: deck shuffling, hand generation (with wash/redeal rule for weak hands), point calculation, valid card determination, trick winner comparison.
- **`src/types.ts`** — `GameState`, `PlayerGameView`, `Player`, `Hand`, `TrickRecord` interfaces; constants (`NUM_PLAYERS=4`, `MAX_BID=34`).
- **`src/protocol.ts`** — Union types for all WebSocket messages (client→server and server→client).

### Frontend (Vanilla JS SPA)

- **`static/app.js`** — Connects via WebSocket, sends/receives messages, handles all screen transitions, auto-reconnects with exponential backoff.
- **`static/index.html`** — 6 screen states: home, lobby, bidding, partner selection, play, game-over.
- **`static/style.css`** — CSS-only card rendering (no images), dark glassmorphism theme.

### Key Design Decisions

**Server-authoritative state:** All game state lives on the Durable Object. Each player's `PlayerGameView` contains only their own hand; others' hands are null. The partner identity is whispered privately.

**One DO per room:** `env.GAME_ROOM.getByName(roomCode)` — the room code is the DO name/key.

**WebSocket flow:** Client connects with `?room=CODE&playerId=ID` → Worker delegates `fetch()` to DO → DO accepts WebSocket via `server.accept()`. Same `playerId` on reconnect restores the session.

**Inactivity cleanup:** If all players disconnect, the DO sets a 5-minute alarm. On alarm, if still empty, all DO storage is purged.

### WebSocket Protocol

Client → Server:
```
join | bid | pass | selectPartner | playCard | playAgain
```

Server → Client:
```
state          # Full PlayerGameView (sent on reconnect and state changes)
joined | bidMade | bidWon | cardPlayed | trickWon | gameOver
youArePartner  # Whispered only to the partner
playerDisconnected | playerReconnected
```

### Game Rules Summary

- 4 players, 13 cards each; hands with ≤4 points are redealt
- Bidding: levels 1–7 × suits (♣ < ♦ < ♥ < ♠ < 🚫 no-trump), encoded as integers 0–34
- Bidder calls a card to designate their partner (secret until that card is played)
- Must follow suit; can't lead trump until trump has been broken
- Win condition: bidder + partner win ≥ (bid level + 6) tricks

## Bot AI (Intermediate)

Bots live entirely server-side in `src/game-room.ts`. All bot methods are private on `GameRoom`.

### Bidding (`getBotBid`)
- Calculate HCP (A=4 K=3 Q=2 J=1) + distribution bonus (+1 per card beyond 4 in any suit)
- < 12 pts → pass; 12–14 → level 1; 15–17 → level 2; 18+ → level 3 (hard cap)
- Trump suit = longest suit in hand (tiebreak: highest HCP). Suits ≤ 3 cards → prefer no-trump
- If preferred suit already bid, try next higher suits at same level up to no-trump; never overbid level

### Partner card selection (`getBotPartnerCard`)
- Picks the highest card the bidder doesn't hold (tries A♠ → K♠ → ... → 2♣)

### Card play (`getBotCard`) — confidence model
- **Before** partner card is played in a trick: confidence = 0.65
- **After** partner card revealed (checked by scanning if `state.partnerCard` is still in any hand): confidence = 0.85
- Each decision rolls `Math.random() < confidence`; failures fall back to basic logic (win if possible, else lowest)

### Bidder team play (`getBotCardAsBidderTeam`, `getBotLeadCard` with `onBidderTeam=true`)
- Following: if a teammate is currently winning → dump lowest (don't steal). If opposition winning → play lowest winning card, else dump lowest.
- Leading: prefer suit the **partner bid** (bid history signal = they have more of it). Else lead longest non-trump suit.

### Opposition play (`getBotCardAsOpposition`, `getBotLeadCard` with `onBidderTeam=false`)
- Following: if an opposition teammate already winning → dump lowest. Else try to win; if can't, dump lowest **non-trump** (conserve trump to block bidder later).
- Leading: never lead trump. Avoid suits the bidder or partner bid (they're strong there). Prefer neutral suits; fallback to any non-trump.

### Bid history as suit signal
`state.bidHistory` entries where `bidNum !== null` indicate the bidder/partner likely holds more of that suit.

## Legacy Code

The root-level Python files (`bridge.py`, `handlers.py`, `main.py`, etc.) are an archived Telegram bot implementation. `bridge.py` was the original source of truth for game logic, which was ported to `bridge.ts`. The Python code is not actively deployed.
