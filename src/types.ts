import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';

export type Suit = '♣' | '♦' | '♥' | '♠';
export type BidSuit = Suit | '🚫';

export const CARD_SUITS: Suit[] = ['♣', '♦', '♥', '♠'];
export const BID_SUITS: BidSuit[] = ['♣', '♦', '♥', '♠', '🚫'];

export type Hand = Record<Suit, string[]>;

export type GamePhase = 'lobby' | 'bidding' | 'partner' | 'play' | 'gameover';

export interface Player {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
}

export interface TrickRecord {
  cards: (string | null)[];
  winner: number;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  hands: Hand[];
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
  partner: number;
  partnerCard: string | null;
  passCount: number;
  lastTrick: TrickRecord | null;
  trickComplete: boolean;
}

export interface PlayerGameView {
  roomCode: string;
  phase: GamePhase;
  players: { name: string; seat: number; connected: boolean }[];
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
}

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  DB: D1Database;
  JWT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
}

export const NUM_PLAYERS = 4;
export const MAX_BID = 34;
export const POINTS_TO_WASH = 4;
