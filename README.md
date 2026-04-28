# Floating Bridge

A web-based multiplayer Singaporean (Floating) Bridge card game that runs entirely on Cloudflare's free tier.

## How to play

1. One player creates a game and shares the 4-character room code
2. Three more players join using the code
3. Cards are dealt automatically, and bidding begins
4. The bid winner picks a partner by calling a card
5. Play 13 tricks -- bidder + partner need their bid to win

### Rules quick reference

- 52-card deck, 4 players, 13 cards each
- Hands with 4 or fewer points are automatically redealt
- Points: A=4, K=3, Q=2, J=1, +1 per card above 4 in a suit
- Bidding: levels 1-7 with suits (clubs < diamonds < hearts < spades < no trump)
- Must follow suit; trump beats led suit; highest card of the winning suit takes the trick
- Bidder + partner need (bid level + 6) tricks to win

## Architecture

- **Cloudflare Workers** -- API routing and static asset serving
- **Durable Objects** -- Game room state with WebSocket Hibernation for real-time play
- **Static frontend** -- Vanilla JS single-page app with CSS-only card rendering

All game state is server-authoritative. Clients connect via WebSocket and receive only their own hand. The partner's identity is whispered only to the partner.

## Project structure

```
src/
  index.ts        Worker entry point (routes /api/create, /api/ws)
  types.ts        Shared TypeScript interfaces
  protocol.ts     Client/server WebSocket message types
  bridge.ts       Game logic (ported from bridge.py)
  game-room.ts    Durable Object with full game state machine
static/
  index.html      SPA shell with 6 screen states
  style.css       Card table layout, CSS-only cards, responsive
  app.js          WebSocket client, reconnection, screen rendering
```

## Development

```bash
npm install
npm run dev
```

This starts a local Wrangler dev server with the Durable Object and static assets.

## Deploy

```bash
npx wrangler login
npm run deploy
```

Deploys to Cloudflare Workers. No paid plan required -- the game fits within free tier limits (100K requests/day, 5 GB DO storage).
