/**
 * God Bot — pure stateless functions.
 *
 * The God Bot has full visibility of all four hands at all times.
 * Every decision is deterministic (no randomness).
 *
 * Strategy: identical to the sophisticated bot, but with three simplifications
 * enabled by omniscience:
 *   1. Partner is always known — no PPM needed.
 *   2. Voids are read directly from hands, not inferred from trick log.
 *   3. All randomness removed — the god bot always picks the objectively best move.
 *
 * Bidding: identical to getBotBidAdvanced — competitive HCP/length/VH model.
 * Partner card: pick the best partner (by trick simulation), then their highest
 *   card the bidder doesn't hold (trump-first).
 * Card play: sophisticated lead/follow logic with full vision.
 */

import type { GameState, Hand, BidSuit, Suit, TrickLogEntry } from './types';
import { CARD_SUITS, BID_SUITS, NUM_PLAYERS, MAX_BID } from './types';
import { getValidSuits, compareCards, getNumFromValue, getBidFromNum } from './bridge';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** HCP (A=4 K=3 Q=2 J=1) + distribution bonus (+1 per card beyond 4 in any suit). */
export function getHandPoints(hand: Hand): number {
  let points = 0;
  for (const suit of CARD_SUITS) {
    const values = hand[suit];
    for (const value of values) {
      if (value === 'A') points += 4;
      else if (value === 'K') points += 3;
      else if (value === 'Q') points += 2;
      else if (value === 'J') points += 1;
    }
    if (values.length >= 5) points += values.length - 4;
  }
  return points;
}

export function lowestCard(cards: string[]): string {
  return cards.reduce((best, card) =>
    getNumFromValue(card.split(' ')[0]) < getNumFromValue(best.split(' ')[0]) ? card : best,
  );
}

export function highestCard(cards: string[]): string {
  return cards.reduce((best, card) =>
    getNumFromValue(card.split(' ')[0]) > getNumFromValue(best.split(' ')[0]) ? card : best,
  );
}

export function isOnBidderTeam(state: GameState, seat: number): boolean {
  return seat === state.bidder || seat === state.partner;
}

export function getOrderedCardsPlayed(state: GameState): string[] {
  const result: string[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const idx = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[idx] !== null) result.push(state.playedCards[idx]!);
  }
  return result;
}

export function getOrderedSeatsPlayed(state: GameState): number[] {
  const result: number[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const idx = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[idx] !== null) result.push(idx);
  }
  return result;
}

export function getCurrentTrickWinnerSeat(state: GameState): number | null {
  if (!state.currentSuit) return null;
  const ordered: string[] = [];
  const seats: number[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const idx = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[idx] !== null) { ordered.push(state.playedCards[idx]!); seats.push(idx); }
  }
  if (ordered.length === 0) return null;
  return seats[compareCards(ordered, state.currentSuit, state.trumpSuit)];
}

/** Seats that have NOT yet played in the current trick, after `seat`. */
export function yetToPlay(state: GameState, seat: number): number[] {
  const result: number[] = [];
  for (let i = 1; i < NUM_PLAYERS; i++) {
    const idx = (seat + i) % NUM_PLAYERS;
    if (state.playedCards[idx] === null) result.push(idx);
  }
  return result;
}

/** True if `card` beats the current best card already on the table. */
export function cardBeatsCurrentBest(state: GameState, card: string): boolean {
  const orderedSoFar = getOrderedCardsPlayed(state);
  if (orderedSoFar.length === 0) return true;
  const test = [...orderedSoFar, card];
  return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
}

/** Filter `cards` to those that can beat the current trick best card. */
export function winningCards(state: GameState, cards: string[]): string[] {
  return cards.filter((card) => cardBeatsCurrentBest(state, card));
}

/** Seats that still have to play AFTER `seat` in the current trick (in play order). */
function getPlayersAfter(state: GameState, seat: number): number[] {
  const myPos = ((seat - state.firstPlayer) + NUM_PLAYERS) % NUM_PLAYERS;
  const after: number[] = [];
  for (let i = myPos + 1; i < NUM_PLAYERS; i++) {
    const s = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[s] === null) after.push(s);
  }
  return after;
}

/** Suits bid by the bidder (non-trump). */
function getBidderBidSuits(state: GameState): Set<string> {
  const suits = new Set<string>();
  for (const entry of state.bidHistory) {
    if (entry.bidNum === null || entry.seat !== state.bidder) continue;
    const suit = getBidFromNum(entry.bidNum).split(' ')[1];
    if (suit !== '🚫') suits.add(suit);
  }
  return suits;
}

/** Suits bid by the partner (non-trump). */
function getPartnerBidSuits(state: GameState): Set<string> {
  const suits = new Set<string>();
  for (const entry of state.bidHistory) {
    if (entry.bidNum === null || entry.seat !== state.partner) continue;
    const suit = getBidFromNum(entry.bidNum).split(' ')[1];
    if (suit !== '🚫') suits.add(suit);
  }
  return suits;
}

/** The suit of the called partner card, or null if not set. */
function getCalledSuit(state: GameState): Suit | null {
  if (!state.partnerCard) return null;
  return state.partnerCard.split(' ')[1] as Suit;
}

/** All cards played across completed tricks and the current trick. */
function getAllPlayedCards(state: GameState): Set<string> {
  const played = new Set<string>();
  for (const entry of state.trickLog) played.add(entry.card);
  for (const c of state.playedCards) { if (c !== null) played.add(c); }
  return played;
}

/** True if `card` is the highest unplayed card in its suit (a guaranteed winner). */
function isBossCard(state: GameState, card: string): boolean {
  const [value, suit] = card.split(' ');
  const played = getAllPlayedCards(state);
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const myRank = RANKS.indexOf(value);
  for (let i = myRank + 1; i < RANKS.length; i++) {
    if (!played.has(`${RANKS[i]} ${suit}`)) return false;
  }
  return true;
}

/**
 * God bot reads voids directly from hands — no inference needed.
 */
function getVoids(state: GameState): Map<number, Set<Suit>> {
  const voids = new Map<number, Set<Suit>>();
  for (let s = 0; s < NUM_PLAYERS; s++) {
    const emptyS = new Set<Suit>();
    for (const suit of CARD_SUITS) {
      if (state.hands[s][suit].length === 0) emptyS.add(suit);
    }
    voids.set(s, emptyS);
  }
  return voids;
}

/**
 * Discard priority (lowest cost first):
 *   1. non-trump non-honors
 *   2. non-trump honors
 *   3. trump (last resort)
 * Partner: never discard the called card unless it is the only card.
 */
function smartDump(state: GameState, seat: number, validCards: string[]): string {
  let pool = validCards;
  if (seat === state.partner && state.partnerCard && pool.length > 1) {
    const filtered = pool.filter((c) => c !== state.partnerCard);
    if (filtered.length > 0) pool = filtered;
  }
  // Find suit with fewest cards (burn it down)
  const hand = state.hands[seat];
  const nonTrump = pool.filter((c) => c.split(' ')[1] !== state.trumpSuit);
  const base = nonTrump.length > 0 ? nonTrump : pool;
  let shortestSuit: string | null = null;
  let shortestLen = Infinity;
  for (const c of base) {
    const suit = c.split(' ')[1] as Suit;
    if (hand[suit].length < shortestLen) { shortestLen = hand[suit].length; shortestSuit = suit; }
  }
  const suitCards = shortestSuit ? base.filter((c) => c.split(' ')[1] === shortestSuit) : base;
  return lowestCard(suitCards.length > 0 ? suitCards : base);
}

function smartDumpAdvanced(state: GameState, seat: number, validCards: string[]): string {
  let pool = validCards;
  if (seat === state.partner && state.partnerCard && pool.length > 1) {
    const filtered = pool.filter((c) => c !== state.partnerCard);
    if (filtered.length > 0) pool = filtered;
  }
  const tier1 = pool.filter(
    (c) => c.split(' ')[1] !== state.trumpSuit && !['A', 'K', 'Q', 'J'].includes(c.split(' ')[0]),
  );
  if (tier1.length > 0) return smartDump(state, seat, tier1);
  const tier2 = pool.filter((c) => c.split(' ')[1] !== state.trumpSuit);
  if (tier2.length > 0) return smartDump(state, seat, tier2);
  return smartDump(state, seat, pool);
}

/** Lead the highest card from the longest non-trump suit (exported for tests). */
export function leadStrongestNonTrump(state: GameState, seat: number, validCards: string[], _trumpSuit?: BidSuit | null): string {
  const hand = state.hands[seat];
  const availableSuits = new Set(validCards.map((c) => c.split(' ')[1]));
  let bestSuit: Suit | null = null;
  let bestLen = 0;
  for (const suit of CARD_SUITS) {
    if (suit === state.trumpSuit) continue;
    if (!availableSuits.has(suit)) continue;
    if (hand[suit].length > bestLen) { bestLen = hand[suit].length; bestSuit = suit; }
  }
  if (bestSuit) {
    const cards = validCards.filter((c) => c.split(' ')[1] === bestSuit);
    if (cards.length > 0) return highestCard(cards);
  }
  return highestCard(validCards);
}

function leadLongestNonTrump(state: GameState, seat: number, validCards: string[]): string {
  const hand = state.hands[seat];
  const availableSuits = new Set(validCards.map((c) => c.split(' ')[1]));
  let bestSuit: Suit | null = null;
  let bestLen = 0;
  for (const suit of CARD_SUITS) {
    if (suit === state.trumpSuit) continue;
    if (!availableSuits.has(suit)) continue;
    if (hand[suit].length > bestLen) { bestLen = hand[suit].length; bestSuit = suit; }
  }
  if (bestSuit) {
    const cards = validCards.filter((c) => c.split(' ')[1] === bestSuit);
    if (cards.length > 0) return bestLen >= 5 ? highestCard(cards) : lowestCard(cards);
  }
  return lowestCard(validCards);
}

// ---------------------------------------------------------------------------
// God Bot Bidding — identical to getBotBidAdvanced
// ---------------------------------------------------------------------------

export function getGodBotBid(state: GameState, seat: number): number | null {
  const hand = state.hands[seat];

  // HCP (wash check: raw HCP < 4 → pass regardless of length)
  let hcp = 0;
  for (const suit of CARD_SUITS) {
    for (const v of hand[suit]) {
      hcp += v === 'A' ? 4 : v === 'K' ? 3 : v === 'Q' ? 2 : v === 'J' ? 1 : 0;
    }
  }
  if (hcp < 4) return null;

  // Length points: 5th card = +1, each beyond = +1
  let lengthPts = 0;
  for (const suit of CARD_SUITS) {
    if (hand[suit].length >= 5) lengthPts += hand[suit].length - 4;
  }

  // Best trump suit: longest, tiebreak by HCP in suit
  let bestSuitIdx = 4; // default NT
  let bestLen = 0;
  let bestSuitHCP = 0;
  for (let si = 0; si < CARD_SUITS.length; si++) {
    const suit = CARD_SUITS[si];
    const sHCP = hand[suit].reduce((s, v) => s + (v === 'A' ? 4 : v === 'K' ? 3 : v === 'Q' ? 2 : v === 'J' ? 1 : 0), 0);
    if (hand[suit].length > bestLen || (hand[suit].length === bestLen && sHCP > bestSuitHCP)) {
      bestLen = hand[suit].length;
      bestSuitHCP = sHCP;
      bestSuitIdx = si;
    }
  }

  // NT priority: balanced + stoppers in ≥3 suits + base HCP ≥ 15
  const balanced = CARD_SUITS.every((s) => hand[s].length <= 4);
  const stoppedSuits = CARD_SUITS.filter((s) => hand[s].includes('A') || hand[s].includes('K')).length;
  if (balanced && stoppedSuits >= 3 && hcp >= 15) {
    bestSuitIdx = 4;
  } else if (bestLen <= 3) {
    bestSuitIdx = 4;
  }

  // Virtual honor: highest missing honor in trump suit
  let vh = 0;
  if (bestSuitIdx < 4) {
    const trumpSuit = CARD_SUITS[bestSuitIdx];
    const held = new Set(hand[trumpSuit]);
    if (!held.has('A')) vh = 4;
    else if (!held.has('K')) vh = 3;
    else if (!held.has('Q')) vh = 2;
  }

  const S = hcp + lengthPts + vh;

  let myMaxLevel: number;
  if (S < 13) return null;
  else if (S < 20) myMaxLevel = 1;
  else if (S < 24) myMaxLevel = 2;
  else myMaxLevel = 3;

  // Competitive suit adjustment
  if (state.bid >= 0) {
    const currentBidSuitIdx = state.bid % 5;
    if (currentBidSuitIdx < 4) {
      const currentBidSuit = CARD_SUITS[currentBidSuitIdx];
      const holding = hand[currentBidSuit].length;
      if (currentBidSuitIdx === bestSuitIdx) {
        myMaxLevel = Math.max(0, myMaxLevel - 1);
      } else if (holding === 0) {
        myMaxLevel = Math.min(3, myMaxLevel + 2);
      } else if (holding <= 3) {
        myMaxLevel = Math.min(3, myMaxLevel + 1);
      }
    }
  }

  // Competitive step-up
  let proposedLevel: number;
  if (state.bid < 0) {
    proposedLevel = 1;
  } else {
    const currentBidLevel = Math.floor(state.bid / 5) + 1;
    const currentSuitIdx = state.bid % 5;
    proposedLevel = bestSuitIdx > currentSuitIdx ? currentBidLevel : currentBidLevel + 1;
  }

  if (proposedLevel > myMaxLevel || proposedLevel > 3) return null;

  const bidNum = (proposedLevel - 1) * 5 + bestSuitIdx;
  if (bidNum > state.bid && bidNum <= MAX_BID) return bidNum;
  return null;
}

// ---------------------------------------------------------------------------
// God Bot Partner Selection
// ---------------------------------------------------------------------------

/**
 * Simple trick estimation for partner selection — greedy simulation.
 * Used only during partner-card selection to find the best partner.
 */
export function estimateTricksForPair(
  state: GameState,
  seat1: number,
  seat2: number,
  trumpSuit: BidSuit | null,
): number {
  const hands: Hand[] = state.hands.map((h) => ({
    '♣': [...h['♣']], '♦': [...h['♦']], '♥': [...h['♥']], '♠': [...h['♠']],
  }));
  let tricks = 0;
  let leader = state.turn;
  let trumpBroken = state.trumpBroken;

  for (let t = 0; t < 13; t++) {
    const played: { seat: number; card: string }[] = [];
    let currentSuit: Suit | null = null;
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const s = (leader + i) % NUM_PLAYERS;
      const validSuits = getValidSuits(hands[s], trumpSuit, currentSuit, trumpBroken);
      if (validSuits.length === 0) break;
      const validCards: string[] = [];
      for (const suit of validSuits) for (const value of hands[s][suit]) validCards.push(`${value} ${suit}`);
      if (validCards.length === 0) break;
      const onTeam = s === seat1 || s === seat2;
      const alreadyPlayed = played.map((p) => p.card);
      let chosen: string;
      if (i === 0) {
        const nonTrump = validCards.filter((c) => c.split(' ')[1] !== trumpSuit);
        chosen = onTeam ? highestCard(nonTrump.length > 0 ? nonTrump : validCards) : lowestCard(validCards);
        currentSuit = chosen.split(' ')[1] as Suit;
      } else {
        const winning = validCards.filter((card) => {
          const test = [...alreadyPlayed, card];
          return compareCards(test, currentSuit!, trumpSuit) === test.length - 1;
        });
        if (onTeam) {
          const currentBest = compareCards(alreadyPlayed, currentSuit!, trumpSuit);
          const bestSeat = played[currentBest]?.seat;
          chosen = (bestSeat === seat1 || bestSeat === seat2)
            ? lowestCard(validCards)
            : winning.length > 0 ? lowestCard(winning) : lowestCard(validCards);
        } else {
          chosen = winning.length > 0 ? lowestCard(winning) : lowestCard(validCards);
        }
      }
      const [val, suit] = chosen.split(' ');
      const idx = hands[s][suit as Suit].indexOf(val);
      if (idx >= 0) hands[s][suit as Suit].splice(idx, 1);
      if (!trumpBroken && suit === trumpSuit && currentSuit !== trumpSuit) trumpBroken = true;
      played.push({ seat: s, card: chosen });
    }
    if (played.length < NUM_PLAYERS) break;
    const orderedCards = played.map((p) => p.card);
    const winnerIdx = compareCards(orderedCards, currentSuit!, trumpSuit);
    const winnerSeat = played[winnerIdx].seat;
    if (winnerSeat === seat1 || winnerSeat === seat2) tricks++;
    leader = winnerSeat;
  }
  return tricks;
}

export function getGodBotPartnerCard(state: GameState, bidderSeat: number): string {
  const myHand = state.hands[bidderSeat];
  const myPoints = Object.values(myHand).flat().reduce((acc, v) =>
    acc + (v === 'A' ? 4 : v === 'K' ? 3 : v === 'Q' ? 2 : v === 'J' ? 1 : 0), 0);

  let bestPartnerSeat = -1;
  let bestTeamTricks = 0;

  for (let p = 0; p < NUM_PLAYERS; p++) {
    if (p === bidderSeat) continue;
    const combinedPoints = myPoints + Object.values(state.hands[p]).flat().reduce((acc, v) =>
      acc + (v === 'A' ? 4 : v === 'K' ? 3 : v === 'Q' ? 2 : v === 'J' ? 1 : 0), 0);
    if (combinedPoints < 18) continue;
    const estimated = estimateTricksForPair(state, bidderSeat, p, state.trumpSuit);
    if (estimated > bestTeamTricks) { bestTeamTricks = estimated; bestPartnerSeat = p; }
  }

  // Fallback: highest HCP
  if (bestPartnerSeat < 0) {
    let maxPts = -1;
    for (let p = 0; p < NUM_PLAYERS; p++) {
      if (p === bidderSeat) continue;
      const pts = Object.values(state.hands[p]).flat().reduce((acc, v) =>
        acc + (v === 'A' ? 4 : v === 'K' ? 3 : v === 'Q' ? 2 : v === 'J' ? 1 : 0), 0);
      if (pts > maxPts) { maxPts = pts; bestPartnerSeat = p; }
    }
  }

  const partnerHand = state.hands[bestPartnerSeat];
  const VALUES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

  // Try trump suit first, then ♠ ♥ ♦ ♣
  const suitsToTry: Suit[] = [];
  if (state.trumpSuit && state.trumpSuit !== '🚫') suitsToTry.push(state.trumpSuit as Suit);
  for (const suit of ['♠', '♥', '♦', '♣'] as Suit[]) {
    if (!suitsToTry.includes(suit)) suitsToTry.push(suit);
  }

  for (const suit of suitsToTry) {
    const partnerHolds = new Set(partnerHand[suit]);
    const bidderHolds = new Set(myHand[suit]);
    for (const value of VALUES) {
      if (partnerHolds.has(value) && !bidderHolds.has(value)) return `${value} ${suit}`;
    }
  }

  // Ultimate fallback
  for (const suit of ['♠', '♥', '♦', '♣'] as Suit[]) {
    const held = new Set(myHand[suit]);
    for (const value of VALUES) {
      if (!held.has(value)) return `${value} ${suit}`;
    }
  }
  return 'A ♠';
}

// ---------------------------------------------------------------------------
// God Bot Card Play — sophisticated logic with full vision
// ---------------------------------------------------------------------------

export function getGodBotCard(state: GameState, seat: number): string {
  const hand = state.hands[seat];
  const validSuits = getValidSuits(hand, state.trumpSuit, state.currentSuit, state.trumpBroken);
  if (validSuits.length === 0) return '';

  const validCards: string[] = [];
  for (const suit of validSuits) for (const value of hand[suit]) validCards.push(`${value} ${suit}`);
  if (validCards.length === 0) return '';

  const trickInProgress = !state.trickComplete && state.playedCards.some((c) => c !== null);

  if (!trickInProgress) {
    return godBotLead(state, seat, validCards);
  }
  return isOnBidderTeam(state, seat)
    ? godBotFollowBidderTeam(state, seat, validCards)
    : godBotFollowOpposition(state, seat, validCards);
}

// ---------------------------------------------------------------------------
// Lead logic
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function godBotLead(state: GameState, seat: number, validCards: string[], _onBidderTeam?: boolean): string {
  const calledSuit = getCalledSuit(state);
  const bidderBidSuits = getBidderBidSuits(state);
  const partnerBidSuits = getPartnerBidSuits(state);
  const voids = getVoids(state);

  if (isOnBidderTeam(state, seat)) {
    // Partner leading: lead low in called suit to set up bidder; else bidder's suit
    if (seat === state.partner && calledSuit) {
      const calledCards = validCards.filter((c) => c.split(' ')[1] === calledSuit);
      if (calledCards.length > 0) return lowestCard(calledCards);
      const bidderSuitCards = validCards.filter(
        (c) => bidderBidSuits.has(c.split(' ')[1]) && c.split(' ')[1] !== state.trumpSuit,
      );
      if (bidderSuitCards.length > 0) return highestCard(bidderSuitCards);
    }

    // God bot advantage: lead into partner's actual strongest suit (full vision)
    const partnerSeat = seat === state.bidder ? state.partner : state.bidder;
    if (partnerSeat >= 0 && partnerSeat < NUM_PLAYERS) {
      const partnerHand = state.hands[partnerSeat];
      let bestSuit: Suit | null = null;
      let bestScore = -1;
      for (const suit of CARD_SUITS) {
        if (suit === state.trumpSuit) continue;
        const mySuitCards = validCards.filter((c) => c.split(' ')[1] === suit);
        if (mySuitCards.length === 0) continue;
        const score = partnerHand[suit].length * 10 +
          (partnerHand[suit].length > 0 ? getNumFromValue(partnerHand[suit][0]) : 0);
        if (score > bestScore) { bestScore = score; bestSuit = suit; }
      }
      if (bestSuit) {
        const suitCards = validCards.filter((c) => c.split(' ')[1] === bestSuit);
        if (suitCards.length > 0) return highestCard(suitCards);
      }
    }

    // Fallback: lead into partner's bid suits (from bid history)
    const partnerSuitCards = validCards.filter(
      (c) => partnerBidSuits.has(c.split(' ')[1]) && c.split(' ')[1] !== state.trumpSuit,
    );
    if (partnerSuitCards.length > 0) return highestCard(partnerSuitCards);

    // God bot advantage: lead trump to draw out opponents' trumps when bidder is void in a side suit
    if (seat === state.bidder && state.trumpSuit && state.trumpSuit !== '🚫') {
      const hasVoidInSideSuit = CARD_SUITS.some(
        (s) => s !== state.trumpSuit && state.hands[seat][s].length === 0,
      );
      if (hasVoidInSideSuit) {
        const trumpCards = validCards.filter((c) => c.split(' ')[1] === state.trumpSuit);
        if (trumpCards.length > 0) return highestCard(trumpCards);
      }
    }

    // Avoid suits where an opponent is void (they would ruff)
    const oppSeats = [0, 1, 2, 3].filter((s) => s !== seat && !isOnBidderTeam(state, s));
    const nonRuffable = validCards.filter((c) => {
      const suit = c.split(' ')[1] as Suit;
      if (suit === state.trumpSuit) return false;
      return !oppSeats.some((s) => voids.get(s)?.has(suit));
    });
    return leadLongestNonTrump(state, seat, nonRuffable.length > 0 ? nonRuffable : validCards);
  } else {
    // Opposition: lead through bidder's weakest suit (god bot knows exact holdings)
    // Attack: lead into a suit where bidder+partner are combined weakest
    let weakestSuit: Suit | null = null;
    let weakestScore = Infinity;
    for (const suit of CARD_SUITS) {
      if (suit === state.trumpSuit) continue;
      const mySuitCards = validCards.filter((c) => c.split(' ')[1] === suit);
      if (mySuitCards.length === 0) continue;
      const bidderLen = state.bidder >= 0 ? state.hands[state.bidder][suit].length : 0;
      const partnerLen = state.partner >= 0 ? state.hands[state.partner][suit].length : 0;
      const score = bidderLen + partnerLen;
      if (score < weakestScore) { weakestScore = score; weakestSuit = suit; }
    }
    if (weakestSuit) {
      const suitCards = validCards.filter((c) => c.split(' ')[1] === weakestSuit);
      if (suitCards.length > 0) return highestCard(suitCards);
    }

    // Avoid bidder/partner bid suits and suits they can ruff
    const bidderTeamSeats = [0, 1, 2, 3].filter((s) => isOnBidderTeam(state, s));
    const safe = validCards.filter((c) => {
      const suit = c.split(' ')[1];
      if (suit === state.trumpSuit) return false;
      if (bidderBidSuits.has(suit) || partnerBidSuits.has(suit)) return false;
      return !bidderTeamSeats.some((s) => voids.get(s)?.has(suit as Suit));
    });
    if (safe.length > 0) return lowestCard(safe);
    const nonTrump = validCards.filter((c) => c.split(' ')[1] !== state.trumpSuit);
    return lowestCard(nonTrump.length > 0 ? nonTrump : validCards);
  }
}

// ---------------------------------------------------------------------------
// Follow logic — bidder team
// ---------------------------------------------------------------------------

export function godBotFollowBidderTeam(state: GameState, seat: number, validCards: string[]): string {
  const orderedSoFar = getOrderedCardsPlayed(state);
  const currentWinnerSeat = getCurrentTrickWinnerSeat(state);
  const afterUs = getPlayersAfter(state, seat);
  const calledSuit = getCalledSuit(state);
  const hand = state.hands[seat];

  // Partner reveal: forced play of called card when opp winning + void risk low
  if (seat === state.partner && state.partnerCard && state.currentSuit && calledSuit) {
    const holdsCalledCard = validCards.includes(state.partnerCard);
    const bidderLedCalledSuit = state.currentSuit === calledSuit;
    const oppWinning = currentWinnerSeat !== null && !isOnBidderTeam(state, currentWinnerSeat);
    const fewInSuit = hand[calledSuit].length < 4;
    if (holdsCalledCard && bidderLedCalledSuit && oppWinning && fewInSuit) {
      return state.partnerCard;
    }
  }

  // Teammate already winning — don't steal
  if (currentWinnerSeat !== null && isOnBidderTeam(state, currentWinnerSeat)) {
    // God bot advantage: check if any opponent can actually beat it
    const remaining = afterUs.filter((s) => !isOnBidderTeam(state, s));
    const opponentCanBeat = remaining.some((oppSeat) => {
      const oppHand = state.hands[oppSeat];
      const oppSuits = getValidSuits(oppHand, state.trumpSuit, state.currentSuit, state.trumpBroken);
      const oppCards: string[] = [];
      for (const suit of oppSuits) for (const v of oppHand[suit]) oppCards.push(`${v} ${suit}`);
      return oppCards.some((card) => {
        const test = [...orderedSoFar, card];
        return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
      });
    });
    if (!opponentCanBeat) return smartDumpAdvanced(state, seat, validCards);
  }

  // God bot: skip second-hand-low — with full vision we always know the best play.

  // Boss card that would win this trick
  const bossCard = validCards.find((c) => {
    if (!isBossCard(state, c)) return false;
    const test = [...orderedSoFar, c];
    return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
  });
  if (bossCard) return bossCard;

  // Void management: ruff if opp winning and we can win with trump
  const isVoidInLedSuit = !!(state.currentSuit && hand[state.currentSuit as Suit]?.length === 0);
  const oppWinningNow = currentWinnerSeat !== null && !isOnBidderTeam(state, currentWinnerSeat);
  if (isVoidInLedSuit && oppWinningNow && state.trumpSuit && state.trumpSuit !== '🚫') {
    const trumpCards = validCards.filter((c) => c.split(' ')[1] === state.trumpSuit);
    const winningTrump = trumpCards.filter((c) => {
      const test = [...orderedSoFar, c];
      return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
    });
    if (winningTrump.length > 0) return lowestCard(winningTrump);
  }

  const partnerBidSuits = getPartnerBidSuits(state);
  const teammateIsLast = afterUs.length > 0 && isOnBidderTeam(state, afterUs[afterUs.length - 1]);
  if (teammateIsLast) {
    const ledSuitIsPartnerStrength = state.currentSuit && partnerBidSuits.has(state.currentSuit);
    if (!ledSuitIsPartnerStrength) return smartDumpAdvanced(state, seat, validCards);
  }

  const winning = validCards.filter((card) => {
    const test = [...orderedSoFar, card];
    return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
  });
  if (winning.length === 0) return smartDumpAdvanced(state, seat, validCards);

  const opponentAfter = afterUs.some((s) => !isOnBidderTeam(state, s));
  return opponentAfter ? highestCard(winning) : lowestCard(winning);
}

// ---------------------------------------------------------------------------
// Follow logic — opposition
// ---------------------------------------------------------------------------

export function godBotFollowOpposition(state: GameState, seat: number, validCards: string[]): string {
  const orderedSoFar = getOrderedCardsPlayed(state);
  const currentWinnerSeat = getCurrentTrickWinnerSeat(state);
  const afterUs = getPlayersAfter(state, seat);
  const hand = state.hands[seat];
  const bidderBidSuits = getBidderBidSuits(state);

  // Opposition teammate already winning
  if (currentWinnerSeat !== null && !isOnBidderTeam(state, currentWinnerSeat)) {
    // God bot advantage: check if bidder team can actually beat it
    const remaining = afterUs.filter((s) => isOnBidderTeam(state, s));
    const bidderTeamCanBeat = remaining.some((btSeat) => {
      const btHand = state.hands[btSeat];
      const btSuits = getValidSuits(btHand, state.trumpSuit, state.currentSuit, state.trumpBroken);
      const btCards: string[] = [];
      for (const suit of btSuits) for (const v of btHand[suit]) btCards.push(`${v} ${suit}`);
      return btCards.some((card) => {
        const test = [...orderedSoFar, card];
        return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
      });
    });
    if (!bidderTeamCanBeat) return smartDumpAdvanced(state, seat, validCards);
  }

  // God bot: skip second-hand-low — with full vision we always know the best play.

  // Boss card that would win this trick
  const bossCard = validCards.find((c) => {
    if (!isBossCard(state, c)) return false;
    const test = [...orderedSoFar, c];
    return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
  });
  if (bossCard) return bossCard;

  // Void management (opposition)
  const isVoidInLedSuit = !!(state.currentSuit && hand[state.currentSuit as Suit]?.length === 0);
  if (isVoidInLedSuit && state.trumpSuit && state.trumpSuit !== '🚫') {
    const currentWinnerCard = currentWinnerSeat !== null ? state.playedCards[currentWinnerSeat] : null;
    const teammateWinningWithTrump =
      currentWinnerSeat !== null &&
      !isOnBidderTeam(state, currentWinnerSeat) &&
      currentWinnerCard?.split(' ')[1] === state.trumpSuit;
    if (teammateWinningWithTrump) return smartDumpAdvanced(state, seat, validCards);

    const bidderTeamWinning = currentWinnerSeat !== null && isOnBidderTeam(state, currentWinnerSeat);
    if (bidderTeamWinning) {
      const trumpCards = validCards.filter((c) => c.split(' ')[1] === state.trumpSuit);
      const winningTrump = trumpCards.filter((c) => {
        const test = [...orderedSoFar, c];
        return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
      });
      if (winningTrump.length > 0) return lowestCard(winningTrump);
    }
  }

  // Only defer to opp teammate when bidder team is NOT currently winning
  const currentWinnerNow = getCurrentTrickWinnerSeat(state);
  const oppTeammateIsLast = afterUs.length > 0 && !isOnBidderTeam(state, afterUs[afterUs.length - 1]);
  if (oppTeammateIsLast && !(currentWinnerNow !== null && isOnBidderTeam(state, currentWinnerNow))) {
    const ledSuitIsBidderStrength = state.currentSuit && bidderBidSuits.has(state.currentSuit);
    if (!ledSuitIsBidderStrength) return smartDumpAdvanced(state, seat, validCards);
  }

  const winning = validCards.filter((card) => {
    const test = [...orderedSoFar, card];
    return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
  });
  if (winning.length === 0) return smartDumpAdvanced(state, seat, validCards);

  const bidderTeamAfter = afterUs.some((s) => isOnBidderTeam(state, s));
  return bidderTeamAfter ? highestCard(winning) : lowestCard(winning);
}
