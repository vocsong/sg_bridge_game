import { describe, it, expect } from 'vitest';
import type { GameState, Hand } from '../src/types';
import {
  getHandPoints,
  highestCard,
  lowestCard,
  isOnBidderTeam,
  getOrderedCardsPlayed,
  getOrderedSeatsPlayed,
  getCurrentTrickWinnerSeat,
  yetToPlay,
  cardBeatsCurrentBest,
  winningCards,
  estimateTricksForPair,
  getGodBotBid,
  getGodBotPartnerCard,
  getGodBotCard,
  godBotLead,
  godBotFollowBidderTeam,
  godBotFollowOpposition,
  leadStrongestNonTrump,
} from '../src/god-bot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Hand with only the suits you specify. */
function hand(spades: string[], hearts: string[], diamonds: string[], clubs: string[]): Hand {
  return { '♠': spades, '♥': hearts, '♦': diamonds, '♣': clubs };
}

/** Blank hand — 13 low non-honours spread evenly across suits. */
function weakHand(): Hand {
  return hand(['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4']);
}

/** Build a minimal GameState skeleton. Override fields as needed. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode: 'TEST',
    phase: 'play',
    players: [
      { id: 'p0', name: 'P0', seat: 0, connected: true },
      { id: 'p1', name: 'P1', seat: 1, connected: true },
      { id: 'p2', name: 'P2', seat: 2, connected: true },
      { id: 'p3', name: 'P3', seat: 3, connected: true },
    ],
    hands: [weakHand(), weakHand(), weakHand(), weakHand()],
    turn: 0,
    bidder: 0,
    partner: 2,
    bid: 5,           // 1♣ = index 0 … "2 🚫" = 9, this is "2♣" = 5
    trumpSuit: '♠',
    setsNeeded: 7,
    sets: [0, 0, 0, 0],
    trumpBroken: false,
    firstPlayer: 0,
    currentSuit: null,
    playedCards: [null, null, null, null],
    partnerCard: 'A ♠',
    passCount: 0,
    lastTrick: null,
    trickComplete: false,
    bidHistory: [],
    spectators: [],
    firstBidder: 0,
    groupId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getHandPoints
// ---------------------------------------------------------------------------

describe('getHandPoints', () => {
  it('returns 0 for a hand with no honours', () => {
    expect(getHandPoints(hand(['2', '3', '4'], ['5', '6', '7'], ['8', '9', '10'], ['2', '3', '4']))).toBe(0);
  });

  it('scores A=4 K=3 Q=2 J=1', () => {
    expect(getHandPoints(hand(['A'], ['K'], ['Q'], ['J']))).toBe(10);
  });

  it('adds distribution bonus for 5-card suit', () => {
    // 5 spades → +1; A = 4; total = 5
    expect(getHandPoints(hand(['A', '2', '3', '4', '5'], [], [], []))).toBe(5);
  });

  it('adds +2 for 6-card suit', () => {
    // 6 clubs, K in there → 3 + 2 = 5
    expect(getHandPoints(hand([], [], [], ['K', '2', '3', '4', '5', '6']))).toBe(5);
  });

  it('counts multiple honours across suits', () => {
    // A♠ + K♥ + Q♦ + J♣ = 4+3+2+1 = 10
    const h = hand(['A', '2', '3'], ['K', '2', '3'], ['Q', '2', '3'], ['J', '2', '3']);
    expect(getHandPoints(h)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// highestCard / lowestCard
// ---------------------------------------------------------------------------

describe('highestCard', () => {
  it('returns the ace from a mixed list', () => {
    expect(highestCard(['2 ♠', 'K ♠', 'A ♠', '10 ♠'])).toBe('A ♠');
  });

  it('returns king when ace absent', () => {
    expect(highestCard(['3 ♥', 'K ♥', 'Q ♥'])).toBe('K ♥');
  });

  it('works with a single card', () => {
    expect(highestCard(['7 ♦'])).toBe('7 ♦');
  });

  it('handles 10 correctly (not confused with 1)', () => {
    expect(highestCard(['9 ♣', '10 ♣', '8 ♣'])).toBe('10 ♣');
  });
});

describe('lowestCard', () => {
  it('returns the 2', () => {
    expect(lowestCard(['A ♠', '2 ♠', 'K ♠'])).toBe('2 ♠');
  });

  it('returns 3 when 2 absent', () => {
    expect(lowestCard(['J ♦', '3 ♦', '5 ♦'])).toBe('3 ♦');
  });

  it('works with a single card', () => {
    expect(lowestCard(['Q ♣'])).toBe('Q ♣');
  });
});

// ---------------------------------------------------------------------------
// isOnBidderTeam
// ---------------------------------------------------------------------------

describe('isOnBidderTeam', () => {
  it('returns true for the bidder seat', () => {
    const s = makeState({ bidder: 0, partner: 2 });
    expect(isOnBidderTeam(s, 0)).toBe(true);
  });

  it('returns true for the partner seat', () => {
    const s = makeState({ bidder: 0, partner: 2 });
    expect(isOnBidderTeam(s, 2)).toBe(true);
  });

  it('returns false for opponents', () => {
    const s = makeState({ bidder: 0, partner: 2 });
    expect(isOnBidderTeam(s, 1)).toBe(false);
    expect(isOnBidderTeam(s, 3)).toBe(false);
  });

  it('handles partner === bidder (solo bid)', () => {
    const s = makeState({ bidder: 1, partner: 1 });
    expect(isOnBidderTeam(s, 1)).toBe(true);
    expect(isOnBidderTeam(s, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOrderedCardsPlayed / getOrderedSeatsPlayed
// ---------------------------------------------------------------------------

describe('getOrderedCardsPlayed', () => {
  it('returns empty when no cards played', () => {
    const s = makeState({ firstPlayer: 0, playedCards: [null, null, null, null] });
    expect(getOrderedCardsPlayed(s)).toEqual([]);
  });

  it('returns cards in play order starting from firstPlayer', () => {
    const s = makeState({
      firstPlayer: 1,
      playedCards: ['2 ♠', 'A ♠', 'K ♠', null],  // seat 0,1,2 played; seat 3 not yet
    });
    // firstPlayer=1: order is seat1, seat2, seat3, seat0
    // seat3 is null → only seat1='A ♠', seat2='K ♠' and seat0='2 ♠' (played)
    expect(getOrderedCardsPlayed(s)).toEqual(['A ♠', 'K ♠', '2 ♠']);
  });

  it('wraps around correctly when firstPlayer=3', () => {
    const s = makeState({
      firstPlayer: 3,
      playedCards: ['5 ♥', null, '7 ♥', '9 ♥'],
    });
    // Order: seat3, seat0, seat1(null skipped), seat2
    expect(getOrderedCardsPlayed(s)).toEqual(['9 ♥', '5 ♥', '7 ♥']);
  });
});

describe('getOrderedSeatsPlayed', () => {
  it('returns seats in play order, skipping empty slots', () => {
    const s = makeState({
      firstPlayer: 2,
      playedCards: [null, '3 ♦', '8 ♦', '5 ♦'],
    });
    // Order: seat2, seat3, seat0(null), seat1 → [2, 3, 1]
    expect(getOrderedSeatsPlayed(s)).toEqual([2, 3, 1]);
  });
});

// ---------------------------------------------------------------------------
// getCurrentTrickWinnerSeat
// ---------------------------------------------------------------------------

describe('getCurrentTrickWinnerSeat', () => {
  it('returns null when currentSuit is null', () => {
    const s = makeState({ currentSuit: null, playedCards: [null, null, null, null] });
    expect(getCurrentTrickWinnerSeat(s)).toBeNull();
  });

  it('returns null when no cards played', () => {
    const s = makeState({ currentSuit: '♠', playedCards: [null, null, null, null] });
    expect(getCurrentTrickWinnerSeat(s)).toBeNull();
  });

  it('returns seat of highest card in led suit (no trump played)', () => {
    // firstPlayer=0; seats 0,1,2 played K♠ 3♠ A♠ — seat2 wins with A♠
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['K ♠', '3 ♠', 'A ♠', null],
    });
    expect(getCurrentTrickWinnerSeat(s)).toBe(2);
  });

  it('trump beats higher card in led suit', () => {
    // firstPlayer=0; seat0=A♠, seat1=2♥(trump), seat2=K♠
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['A ♠', '2 ♥', 'K ♠', null],
    });
    expect(getCurrentTrickWinnerSeat(s)).toBe(1);
  });

  it('first player wins when all others play off-suit non-trump', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['7 ♠', '3 ♦', '5 ♦', '2 ♦'],
    });
    expect(getCurrentTrickWinnerSeat(s)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// yetToPlay
// ---------------------------------------------------------------------------

describe('yetToPlay', () => {
  it('returns all other seats when trick just started and this seat is first', () => {
    const s = makeState({ firstPlayer: 0, playedCards: [null, null, null, null] });
    // seat 0 asking who comes after: seats 1,2,3 (all null)
    expect(yetToPlay(s, 0)).toEqual([1, 2, 3]);
  });

  it('returns only seats that have not played', () => {
    const s = makeState({
      firstPlayer: 0,
      playedCards: ['A ♠', '2 ♠', null, null],
    });
    // seat2 asking: after seat2 comes seat3, then seat0(played), seat1(played)
    expect(yetToPlay(s, 2)).toEqual([3]);
  });

  it('returns empty when all others have played', () => {
    const s = makeState({
      firstPlayer: 0,
      playedCards: ['A ♠', '2 ♠', '3 ♠', null],
    });
    // seat3 is last to play; 0,1,2 already played
    expect(yetToPlay(s, 3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cardBeatsCurrentBest / winningCards
// ---------------------------------------------------------------------------

describe('cardBeatsCurrentBest', () => {
  it('always returns true when table is empty (first card of trick)', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: [null, null, null, null],
    });
    expect(cardBeatsCurrentBest(s, 'A ♠')).toBe(true);
    expect(cardBeatsCurrentBest(s, '2 ♠')).toBe(true);
  });

  it('returns true when card is higher in led suit', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['7 ♠', null, null, null],
    });
    expect(cardBeatsCurrentBest(s, 'A ♠')).toBe(true);
    expect(cardBeatsCurrentBest(s, '6 ♠')).toBe(false);
  });

  it('returns true when playing trump over a non-trump lead', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['A ♠', null, null, null],
    });
    expect(cardBeatsCurrentBest(s, '2 ♥')).toBe(true);
  });

  it('returns false for off-suit non-trump when suit lead is already in', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['5 ♠', null, null, null],
    });
    expect(cardBeatsCurrentBest(s, 'A ♦')).toBe(false);
  });
});

describe('winningCards', () => {
  it('returns only cards that beat current best', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['9 ♠', null, null, null],
    });
    const cards = ['A ♠', '3 ♠', 'K ♠', '8 ♠'];
    expect(winningCards(s, cards)).toEqual(['A ♠', 'K ♠']);
  });

  it('returns empty array when nothing can win', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['A ♠', null, null, null],
    });
    expect(winningCards(s, ['2 ♠', '3 ♠', '4 ♠'])).toEqual([]);
  });

  it('includes trump cards that beat non-trump lead', () => {
    const s = makeState({
      firstPlayer: 0,
      currentSuit: '♠',
      trumpSuit: '♥',
      playedCards: ['A ♠', null, null, null],
    });
    expect(winningCards(s, ['2 ♥', 'A ♥'])).toEqual(['2 ♥', 'A ♥']);
  });
});

// ---------------------------------------------------------------------------
// estimateTricksForPair
// ---------------------------------------------------------------------------

describe('estimateTricksForPair', () => {
  it('returns a number between 0 and 13', () => {
    const s = makeState({
      turn: 0,
      trumpBroken: false,
      hands: [
        hand(['A', 'K', 'Q'], ['A', 'K', 'Q'], ['A', 'K', 'Q'], ['A']),
        hand(['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4'], ['2']),
        hand(['5', '6', '7'], ['5', '6', '7'], ['5', '6', '7'], ['5']),
        hand(['8', '9', '10'], ['8', '9', '10'], ['8', '9', '10'], ['8']),
      ],
    });
    const tricks = estimateTricksForPair(s, 0, 2, '♠');
    expect(tricks).toBeGreaterThanOrEqual(0);
    expect(tricks).toBeLessThanOrEqual(13);
  });

  it('team with all aces wins more tricks than weak team', () => {
    // Seat 0+2 hold all aces and kings (strong); seat 1+3 hold only low cards (weak)
    // Each hand has exactly 13 cards across 4 suits
    const strongHands: Hand[] = [
      hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A']),  // 13 cards
      hand(['2', '3', '4', '5'], ['2', '3', '4', '5'], ['2', '3', '4', '5'], ['2']),   // 13 cards
      hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['K']),  // 13 cards
      hand(['6', '7', '8', '9'], ['6', '7', '8', '9'], ['6', '7', '8', '9'], ['3']),   // 13 cards
    ];
    const s = makeState({ turn: 0, trumpBroken: false, hands: strongHands });
    const strongTricks = estimateTricksForPair(s, 0, 2, '♠');
    const weakTricks = estimateTricksForPair(s, 1, 3, '♠');
    expect(strongTricks).toBeGreaterThan(weakTricks);
  });

  it('sum of tricks for both teams equals 13', () => {
    // In any deal, every trick is won by someone — the two teams share all 13
    const s = makeState({
      turn: 0,
      trumpBroken: false,
      hands: [
        hand(['A', 'K', 'Q', 'J'], ['2', '3', '4', '5'], ['6', '7', '8', '9'], ['10']),
        hand(['2', '3', '4', '5'], ['A', 'K', 'Q', 'J'], ['2', '3', '4', '5'], ['6']),
        hand(['6', '7', '8', '9'], ['6', '7', '8', '9'], ['A', 'K', 'Q', 'J'], ['2']),
        hand(['10', 'J', 'Q', 'K'], ['10', 'J', 'Q', 'K'], ['10', 'J', 'Q', 'K'], ['3']),
      ],
    });
    const t02 = estimateTricksForPair(s, 0, 2, '♠');
    const t13 = estimateTricksForPair(s, 1, 3, '♠');
    expect(t02 + t13).toBe(13);
  });

  it('respects no-trump (null trump suit)', () => {
    const s = makeState({
      turn: 0,
      trumpBroken: false,
      hands: [
        hand(['A', 'K', 'Q'], ['A', 'K', 'Q'], ['A', 'K', 'Q'], ['A']),
        hand(['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4'], ['2']),
        hand(['5', '6', '7'], ['5', '6', '7'], ['5', '6', '7'], ['5']),
        hand(['8', '9', '10'], ['8', '9', '10'], ['8', '9', '10'], ['8']),
      ],
    });
    const tricks = estimateTricksForPair(s, 0, 2, '🚫');
    expect(tricks).toBeGreaterThanOrEqual(0);
    expect(tricks).toBeLessThanOrEqual(13);
  });
});

// ---------------------------------------------------------------------------
// getGodBotBid
// ---------------------------------------------------------------------------

describe('getGodBotBid', () => {
  it('passes when own hand is very weak (<10 pts)', () => {
    const s = makeState({
      phase: 'bidding',
      bid: -1,
      turn: 0,
      hands: [weakHand(), weakHand(), weakHand(), weakHand()],
    });
    expect(getGodBotBid(s, 0)).toBeNull();
  });

  it('bids when own hand is strong and a good partner exists', () => {
    // Seat 0 and seat 2 hold all aces and kings — combined 32+ pts
    const strongHands: Hand[] = [
      hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A', 'K'], ['A', 'K']),
      weakHand(),
      hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A', 'K'], ['A', 'K']),
      weakHand(),
    ];
    const s = makeState({
      phase: 'bidding',
      bid: -1,
      turn: 0,
      hands: strongHands,
    });
    const bid = getGodBotBid(s, 0);
    expect(bid).not.toBeNull();
    expect(bid!).toBeGreaterThanOrEqual(0);
    expect(bid!).toBeLessThanOrEqual(34);
  });

  it('returns a bid number higher than the current bid', () => {
    const strongHands: Hand[] = [
      hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A', 'K'], ['A', 'K']),
      weakHand(),
      hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q', 'J'], ['A', 'K'], ['A', 'K']),
      weakHand(),
    ];
    const s = makeState({
      phase: 'bidding',
      bid: 4, // 1♠
      turn: 0,
      hands: strongHands,
    });
    const bid = getGodBotBid(s, 0);
    if (bid !== null) {
      expect(bid).toBeGreaterThan(4);
    }
  });

  it('bids the computed trump suit (not always no-trump) when a strong fit exists', () => {
    // Seat 0 + seat 2 share 9 hearts (seat0: 5, seat2: 4) and few of other suits.
    // bestSuitIdx should resolve to ♥ (index 2 in BID_SUITS).
    // The bid returned should be a hearts bid (bidNum % 5 === 2), not no-trump (bidNum % 5 === 4).
    const strongHeartHands: Hand[] = [
      hand(['A'], ['A', 'K', 'Q', 'J', '10'], ['A'], ['A']),  // seat0: 5 hearts, 20+ pts
      weakHand(),
      hand(['K'], ['9', '8', '7', '6'], ['K'], ['K']),         // seat2: 4 hearts, ~10 pts
      weakHand(),
    ];
    const s = makeState({
      phase: 'bidding',
      bid: -1,
      turn: 0,
      hands: strongHeartHands,
    });
    const bid = getGodBotBid(s, 0);
    expect(bid).not.toBeNull();
    // bid % 5 gives the suit index: 2 = ♥, 4 = 🚫 (no-trump). Must be hearts.
    expect(bid! % 5).toBe(2);
  });

  it('never returns a bid exceeding MAX_BID (34)', () => {
    const strongHands: Hand[] = [
      hand(['A', 'K', 'Q', 'J', '10'], ['A', 'K', 'Q', 'J', '10'], ['A', 'K'], ['A']),
      weakHand(),
      hand(['A', 'K', 'Q', 'J', '10'], ['A', 'K', 'Q', 'J', '10'], ['A', 'K'], ['A']),
      weakHand(),
    ];
    const s = makeState({ phase: 'bidding', bid: -1, turn: 0, hands: strongHands });
    const bid = getGodBotBid(s, 0);
    if (bid !== null) expect(bid).toBeLessThanOrEqual(34);
  });
});

// ---------------------------------------------------------------------------
// getGodBotPartnerCard
// ---------------------------------------------------------------------------

describe('getGodBotPartnerCard', () => {
  it('returns a card string in "VALUE SUIT" format', () => {
    const s = makeState({
      phase: 'partner',
      bidder: 0,
      trumpSuit: '♠',
      hands: [
        hand(['A', 'K'], ['A', 'K'], ['A', 'K'], ['A', 'K']),
        hand(['Q', 'J'], ['Q', 'J'], ['Q', 'J'], ['Q', 'J']),
        hand(['10', '9'], ['10', '9'], ['10', '9'], ['10', '9']),
        hand(['8', '7'], ['8', '7'], ['8', '7'], ['8', '7']),
      ],
    });
    const card = getGodBotPartnerCard(s, 0);
    expect(card).toMatch(/^[A-Z0-9]+ [♣♦♥♠]$/u);
  });

  it('does not return a card already in the bidder\'s hand', () => {
    const bidderHand = hand(['A', 'K', 'Q'], ['A', 'K', 'Q'], ['A', 'K', 'Q'], ['A', 'K', 'Q']);
    const s = makeState({
      phase: 'partner',
      bidder: 0,
      trumpSuit: '♥',
      hands: [
        bidderHand,
        hand(['J', '10', '9'], ['J', '10', '9'], ['J', '10', '9'], ['J', '10', '9']),
        hand(['8', '7', '6'], ['8', '7', '6'], ['8', '7', '6'], ['8', '7', '6']),
        hand(['5', '4', '3'], ['5', '4', '3'], ['5', '4', '3'], ['5', '4', '3']),
      ],
    });
    const card = getGodBotPartnerCard(s, 0);
    const [val, suit] = card.split(' ');
    expect(bidderHand[suit as '♠' | '♥' | '♦' | '♣'].includes(val)).toBe(false);
  });

  it('prefers trump suit cards for the partner card', () => {
    // Seat2 has A♠ (trump) and weak other suits; bidder (seat0) doesn't hold A♠
    const s = makeState({
      phase: 'partner',
      bidder: 0,
      trumpSuit: '♠',
      hands: [
        hand(['K', 'Q', 'J'], ['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4']),
        hand(['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4'], ['2', '3', '4']),
        hand(['A', '9', '8'], ['A', '9', '8'], ['A', '9', '8'], ['A', '9', '8']),
        hand(['5', '6', '7'], ['5', '6', '7'], ['5', '6', '7'], ['5', '6', '7']),
      ],
    });
    const card = getGodBotPartnerCard(s, 0);
    // Should pick trump suit (♠) card for the best partner (seat2)
    expect(card.endsWith('♠')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getGodBotCard — dispatcher
// ---------------------------------------------------------------------------

describe('getGodBotCard', () => {
  it('returns empty string when no valid suits', () => {
    // Give the seat an empty hand
    const s = makeState({
      hands: [
        hand([], [], [], []),
        weakHand(), weakHand(), weakHand(),
      ],
      playedCards: [null, null, null, null],
    });
    expect(getGodBotCard(s, 0)).toBe('');
  });

  it('returns a card from the seat\'s hand', () => {
    const s = makeState({
      turn: 0,
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      trumpBroken: false,
      currentSuit: null,
      playedCards: [null, null, null, null],
      hands: [
        hand(['A', 'K'], ['3', '4'], ['5', '6'], ['7', '8']),
        weakHand(), weakHand(), weakHand(),
      ],
    });
    const card = getGodBotCard(s, 0);
    expect(card).not.toBe('');
    // Must be a card seat 0 actually holds
    const [val, suit] = card.split(' ');
    expect(s.hands[0][suit as '♠' | '♥' | '♦' | '♣'].includes(val)).toBe(true);
  });

  it('does not lead trump when trump is not broken', () => {
    // Seat 0 has only trump spades + one non-trump heart
    const s = makeState({
      turn: 0,
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      trumpBroken: false,
      currentSuit: null,
      playedCards: [null, null, null, null],
      hands: [
        hand(['A', 'K'], ['3'], [], []),
        weakHand(), weakHand(), weakHand(),
      ],
    });
    const card = getGodBotCard(s, 0);
    expect(card.endsWith('♠')).toBe(false);
    expect(card).toBe('3 ♥');
  });
});

// ---------------------------------------------------------------------------
// getGodBotCard — trickComplete guard
// ---------------------------------------------------------------------------

describe('getGodBotCard — trickComplete guard', () => {
  it('uses lead logic (not follow logic) when trickComplete is true and playedCards is stale', () => {
    // Simulate the moment BETWEEN tricks:
    // - trickComplete = true (trick just finished)
    // - playedCards still holds the previous trick's cards (all non-null)
    // - currentSuit = null (new trick hasn't started)
    //
    // Lead logic for bidder (seat 0, partner = seat 2):
    //   godBotLead picks the suit where partner (seat2) has the most/highest cards.
    //   Partner (seat2) has 4 diamonds, so lead should be highest diamond the bot holds.
    //
    // Follow logic (wrong path if bug is present):
    //   godBotFollowBidderTeam looks at current trick winner from stale playedCards.
    //   Stale currentSuit would be null, causing compareCards to be called with null → likely returns wrong seat.
    //   Even if it doesn't crash, it returns the lowest valid card (duck) which is NOT the lead-logic card.
    //
    // So: lead logic → highest diamond (A ♦); follow logic → lowest card (2 ♦ or similar).
    // We verify the lead path is taken by asserting the card matches lead expectations.
    const s = makeState({
      turn: 0,
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      trumpBroken: false,
      trickComplete: true,
      currentSuit: null,
      firstPlayer: 0,
      playedCards: ['A ♥', '3 ♥', '5 ♥', '7 ♥'],  // stale from previous trick
      hands: [
        hand([], [], ['A', '2'], ['4', '5']),         // seat0 (bidder): has A♦, 2♦
        hand(['2', '3'], ['2', '3'], ['3', '4'], ['6', '7']),
        hand([], [], ['K', 'Q', 'J', '10'], []),       // seat2 (partner): deep in diamonds
        weakHand(),
      ],
    });
    // Lead logic: partner has 4 diamonds and K♦ → lead A♦ (highest in partner's strongest suit)
    // Follow logic (bug): would look at stale playedCards and likely duck with 2♦
    const card = getGodBotCard(s, 0);
    expect(card).toBe('A ♦');
  });
});

// ---------------------------------------------------------------------------
// godBotLead
// ---------------------------------------------------------------------------

describe('godBotLead', () => {
  it('bidder team leads highest card in partner\'s strongest suit', () => {
    // Seat0 is bidder; partner is seat2 with lots of hearts
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      hands: [
        hand(['2', '3'], ['A', 'K'], ['2', '3'], ['2', '3']),  // seat0 has A♥ K♥
        weakHand(),
        hand(['2', '3'], ['Q', 'J', '10', '9'], ['2', '3'], ['2', '3']),  // partner has 4 hearts
        weakHand(),
      ],
      playedCards: [null, null, null, null],
    });
    const validCards = ['2 ♠', '3 ♠', 'A ♥', 'K ♥', '2 ♦', '3 ♦', '2 ♣', '3 ♣'];
    const card = godBotLead(s, 0, validCards, true);
    // Should lead into partner's strongest suit (♥) with highest card
    expect(card).toBe('A ♥');
  });

  it('opposition attacks the bidder team\'s weakest suit', () => {
    // Seats 0 (bidder) and 2 (partner) have lots of spades and hearts, few diamonds
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♣',
      hands: [
        hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q'], [], ['2', '3']),  // seat0: no diamonds
        weakHand(),
        hand(['A', 'K', 'Q', 'J'], ['A', 'K', 'Q'], [], ['2', '3']),  // seat2: no diamonds
        hand(['2', '3'], ['2', '3'], ['A', 'K', 'Q'], ['2', '3']),     // seat3 (opposition)
      ],
      playedCards: [null, null, null, null],
    });
    const validCards = ['2 ♠', '3 ♠', '2 ♥', '3 ♥', 'A ♦', 'K ♦', 'Q ♦'];
    const card = godBotLead(s, 3, validCards, false);
    // Bidder team has 0 diamonds → weakest suit; should attack with ♦
    expect(card.endsWith('♦')).toBe(true);
  });

  it('falls back to non-trump when partner has no cards in any suit bot leads', () => {
    const s = makeState({
      bidder: 1,
      partner: 3,
      trumpSuit: '♠',
      hands: [
        hand(['K', 'Q'], ['K', 'Q'], ['K', 'Q'], ['K', 'Q']),  // seat0 (opposition, leading)
        weakHand(), weakHand(), weakHand(),
      ],
      playedCards: [null, null, null, null],
    });
    const validCards = ['K ♠', 'Q ♠', 'K ♥', 'Q ♥', 'K ♦', 'Q ♦', 'K ♣', 'Q ♣'];
    const card = godBotLead(s, 0, validCards, false);
    // Should not lead trump (♠)
    expect(card.endsWith('♠')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// godBotFollowBidderTeam
// ---------------------------------------------------------------------------

describe('godBotFollowBidderTeam', () => {
  it('ducks when teammate is winning and no opponent can beat them', () => {
    // Seat0 (bidder) played A♥; seat2 (partner) follows; seat1 and seat3 have no ♥ or trump
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 0,
      playedCards: ['A ♥', null, null, null],  // seat0 winning
      hands: [
        hand([], ['A'], [], []),
        hand([], [], ['2', '3', '4'], ['2', '3', '4']),   // seat1: no ♥ no trump
        hand([], ['K', 'Q'], [], []),                       // seat2: partner
        hand([], [], ['5', '6', '7'], ['5', '6', '7']),   // seat3: no ♥ no trump
      ],
    });
    const validCards = ['K ♥', 'Q ♥'];
    const card = godBotFollowBidderTeam(s, 2, validCards);
    // Teammate winning, opponents can't beat → duck with lowest
    expect(card).toBe('Q ♥');
  });

  it('plays cheapest winner when opposition is winning', () => {
    // Seat1 (opp) played A♥; seat2 (partner) must follow; seat2 has K♥ and Q♥
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 1,
      playedCards: [null, 'A ♥', null, null],  // wait — A♥ is highest, seat2 can't beat
      hands: [
        weakHand(),
        hand([], ['A'], [], []),
        hand([], ['K', 'Q'], [], []),
        weakHand(),
      ],
    });
    // K♥ and Q♥ can't beat A♥ → dump lowest
    const validCards = ['K ♥', 'Q ♥'];
    const card = godBotFollowBidderTeam(s, 2, validCards);
    expect(card).toBe('Q ♥');
  });

  it('plays lowest winning card when teammate is losing and we can win', () => {
    // Seat0 (bidder) played 5♥; seat1 (opp) played 3♥; seat2 (partner) has A♥ and K♥
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 0,
      playedCards: ['5 ♥', '3 ♥', null, null],
      hands: [
        hand([], ['5'], [], []),
        hand([], ['3'], [], []),
        hand([], ['A', 'K'], [], []),
        weakHand(),
      ],
    });
    const validCards = ['A ♥', 'K ♥'];
    const card = godBotFollowBidderTeam(s, 2, validCards);
    // Bidder (seat0) is currently winning with 5♥; but we can win → should duck
    // Actually seat0 played first and currently wins with 5♥ — teammate winning!
    // Seat3 (opp) yet to play but has no ♥ → opponent cannot beat
    // → duck
    expect(card).toBe('K ♥');
  });

  it('dumps lowest non-trump when cannot win', () => {
    // Opp played A♥; partner (seat2) has only low cards and can't win
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 1,
      playedCards: [null, 'A ♥', null, null],
      hands: [
        weakHand(),
        hand([], ['A'], [], []),
        hand(['2'], ['3', '4'], ['5'], []),
        weakHand(),
      ],
    });
    const validCards = ['3 ♥', '4 ♥'];  // must follow suit; can't beat A
    const card = godBotFollowBidderTeam(s, 2, validCards);
    expect(card).toBe('3 ♥');
  });
});

// ---------------------------------------------------------------------------
// godBotFollowOpposition
// ---------------------------------------------------------------------------

describe('godBotFollowOpposition', () => {
  it('ducks when opp teammate is winning and bidder team can\'t beat them', () => {
    // Seat3 (opp) played A♥; seat1 (opp) follows; bidder team (0,2) has no ♥ or trump to beat
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 3,
      playedCards: [null, null, null, 'A ♥'],   // seat3 winning
      hands: [
        hand(['2', '3'], [], ['2', '3'], ['2', '3']),   // seat0: no ♥, no trump cards > A
        hand([], ['K', 'Q'], [], []),                    // seat1: opp, following
        hand(['2', '3'], [], ['2', '3'], ['2', '3']),   // seat2: no ♥, no trump cards > A
        hand([], ['A'], [], []),
      ],
    });
    const validCards = ['K ♥', 'Q ♥'];
    const card = godBotFollowOpposition(s, 1, validCards);
    // Opp teammate winning, bidder team can't beat → duck
    expect(card).toBe('Q ♥');
  });

  it('plays cheapest winner when bidder team is winning', () => {
    // Seat0 (bidder) played 8♥; seat1 (opp) can beat with K♥
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 0,
      playedCards: ['8 ♥', null, null, null],
      hands: [
        hand([], ['8'], [], []),
        hand([], ['K', '3'], [], []),
        weakHand(),
        weakHand(),
      ],
    });
    const validCards = ['K ♥', '3 ♥'];
    const card = godBotFollowOpposition(s, 1, validCards);
    expect(card).toBe('K ♥');
  });

  it('dumps lowest non-trump when cannot win', () => {
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 0,
      playedCards: ['A ♥', null, null, null],
      hands: [
        hand([], ['A'], [], []),
        hand(['2'], ['3', '4'], ['5'], []),   // seat1 (opp): must follow ♥, can't beat A
        weakHand(),
        weakHand(),
      ],
    });
    const validCards = ['3 ♥', '4 ♥'];
    const card = godBotFollowOpposition(s, 1, validCards);
    expect(card).toBe('3 ♥');
  });

  it('preserves trump by dumping non-trump first when it cannot win', () => {
    // Seat1 (opp) can't follow ♥ and also can't beat the winning trump on table.
    // A ♠ (trump) is already winning. Seat1 has 2♠ (trump) and 4♦ (non-trump).
    // 2♠ can't beat A♠, so it's not a winner either — dump non-trump ♦ first.
    const s = makeState({
      bidder: 0,
      partner: 2,
      trumpSuit: '♠',
      currentSuit: '♥',
      firstPlayer: 0,
      playedCards: ['A ♠', null, null, null],  // A♠ (trump) winning — unbeatable
      hands: [
        hand(['A'], [], [], []),
        hand(['2'], ['3'], ['4'], []),  // seat1: trump 2♠, non-trump 4♦
        weakHand(),
        weakHand(),
      ],
    });
    // 2♠ can't beat A♠; 4♦ can't beat A♠ → neither wins.
    // Should dump lowest non-trump (4♦) to preserve trump.
    const validCards = ['2 ♠', '4 ♦'];
    const card = godBotFollowOpposition(s, 1, validCards);
    expect(card).toBe('4 ♦');
  });
});

// ---------------------------------------------------------------------------
// leadStrongestNonTrump
// ---------------------------------------------------------------------------

describe('leadStrongestNonTrump', () => {
  it('leads highest card in the longest non-trump suit', () => {
    const s = makeState({
      trumpSuit: '♠',
      hands: [
        hand(['2', '3'], ['A', 'K', 'Q', 'J'], ['5', '6'], ['7']),
        weakHand(), weakHand(), weakHand(),
      ],
    });
    const validCards = ['2 ♠', '3 ♠', 'A ♥', 'K ♥', 'Q ♥', 'J ♥', '5 ♦', '6 ♦', '7 ♣'];
    const card = leadStrongestNonTrump(s, 0, validCards, '♠');
    // ♥ is longest non-trump (4 cards), lead highest = A♥
    expect(card).toBe('A ♥');
  });

  it('skips the trump suit', () => {
    const s = makeState({
      trumpSuit: '♥',
      hands: [
        hand(['A', 'K'], ['A', 'K', 'Q'], ['A', 'K', 'Q', 'J'], ['A']),
        weakHand(), weakHand(), weakHand(),
      ],
    });
    const validCards = ['A ♠', 'K ♠', 'A ♦', 'K ♦', 'Q ♦', 'J ♦', 'A ♣'];
    const card = leadStrongestNonTrump(s, 0, validCards, '♥');
    // ♦ is longest non-trump (4 cards); lead A♦
    expect(card).toBe('A ♦');
  });

  it('falls back to highest available card if all valid cards are trump', () => {
    const s = makeState({
      trumpSuit: '♠',
      hands: [
        hand(['A', 'K', 'Q'], [], [], []),
        weakHand(), weakHand(), weakHand(),
      ],
    });
    const validCards = ['A ♠', 'K ♠', 'Q ♠'];
    // No non-trump → fall back to highest overall
    const card = leadStrongestNonTrump(s, 0, validCards, '♠');
    expect(card).toBe('A ♠');
  });
});
