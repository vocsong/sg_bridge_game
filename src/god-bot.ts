/**
 * God Bot — pure stateless functions.
 *
 * The God Bot has full visibility of all four hands at all times.
 * Every decision is deterministic (no randomness).
 *
 * These functions are exported so they can be unit-tested independently,
 * and called from GameRoom in game-room.ts.
 */

import type { GameState, Hand, BidSuit, Suit } from './types';
import { CARD_SUITS, BID_SUITS, NUM_PLAYERS, MAX_BID } from './types';
import { getValidSuits, compareCards, getNumFromValue } from './bridge';

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

/** Return the highest-ranked card from an array of card strings ("A ♠", "10 ♥", …). */
export function highestCard(cards: string[]): string {
  return cards.reduce((best, card) => {
    return getNumFromValue(card.split(' ')[0]) > getNumFromValue(best.split(' ')[0]) ? card : best;
  });
}

/** Return the lowest-ranked card from an array of card strings. */
export function lowestCard(cards: string[]): string {
  return cards.reduce((best, card) => {
    return getNumFromValue(card.split(' ')[0]) < getNumFromValue(best.split(' ')[0]) ? card : best;
  });
}

/** True if `seat` is on the bidder's team (bidder or partner). */
export function isOnBidderTeam(state: GameState, seat: number): boolean {
  return seat === state.bidder || seat === state.partner;
}

/**
 * Cards played so far this trick, in play order (starting from firstPlayer).
 */
export function getOrderedCardsPlayed(state: GameState): string[] {
  const result: string[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const idx = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[idx] !== null) result.push(state.playedCards[idx]!);
  }
  return result;
}

/**
 * Seats that have already played a card this trick, in play order.
 */
export function getOrderedSeatsPlayed(state: GameState): number[] {
  const result: number[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const idx = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[idx] !== null) result.push(idx);
  }
  return result;
}

/**
 * The seat currently winning the trick, or null if no card has been played yet.
 */
export function getCurrentTrickWinnerSeat(state: GameState): number | null {
  if (!state.currentSuit) return null;
  const ordered: string[] = [];
  const seats: number[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const idx = (state.firstPlayer + i) % NUM_PLAYERS;
    if (state.playedCards[idx] !== null) {
      ordered.push(state.playedCards[idx]!);
      seats.push(idx);
    }
  }
  if (ordered.length === 0) return null;
  return seats[compareCards(ordered, state.currentSuit, state.trumpSuit)];
}

/**
 * Seats that have NOT yet played in the current trick, in play order after `seat`.
 */
export function yetToPlay(state: GameState, seat: number): number[] {
  const result: number[] = [];
  for (let i = 1; i < NUM_PLAYERS; i++) {
    const idx = (seat + i) % NUM_PLAYERS;
    if (state.playedCards[idx] === null) result.push(idx);
  }
  return result;
}

/**
 * True if `card` would beat the current best card already on the table.
 * Always true when the table is empty (first card of the trick).
 */
export function cardBeatsCurrentBest(state: GameState, card: string): boolean {
  const orderedSoFar = getOrderedCardsPlayed(state);
  if (orderedSoFar.length === 0) return true;
  const test = [...orderedSoFar, card];
  return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
}

/**
 * Filter `cards` to those that can beat the current trick best card.
 */
export function winningCards(state: GameState, cards: string[]): string[] {
  return cards.filter((card) => cardBeatsCurrentBest(state, card));
}

// ---------------------------------------------------------------------------
// Trick estimation (greedy simulation)
// ---------------------------------------------------------------------------

/**
 * Estimate how many tricks the team (seat1, seat2) will win across all
 * remaining tricks, using a greedy heuristic simulation.
 *
 * - Team leads: highest non-trump (or highest if only trump left).
 * - Team follows: duck if teammate already winning; else cheapest winner; else lowest.
 * - Opponents lead: lowest card.
 * - Opponents follow: cheapest winner; else lowest.
 */
export function estimateTricksForPair(
  state: GameState,
  seat1: number,
  seat2: number,
  trumpSuit: BidSuit | null,
): number {
  // Deep-clone the four hands
  const hands: Hand[] = state.hands.map((h) => ({
    '♣': [...h['♣']],
    '♦': [...h['♦']],
    '♥': [...h['♥']],
    '♠': [...h['♠']],
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
      for (const suit of validSuits) {
        for (const value of hands[s][suit]) validCards.push(`${value} ${suit}`);
      }
      if (validCards.length === 0) break;

      const onTeam = s === seat1 || s === seat2;
      const alreadyPlayed = played.map((p) => p.card);
      let chosen: string;

      if (i === 0) {
        // Leading
        if (onTeam) {
          const nonTrump = validCards.filter((c) => c.split(' ')[1] !== trumpSuit);
          chosen = highestCard(nonTrump.length > 0 ? nonTrump : validCards);
        } else {
          chosen = lowestCard(validCards);
        }
        currentSuit = chosen.split(' ')[1] as Suit;
      } else {
        const winning = validCards.filter((card) => {
          const test = [...alreadyPlayed, card];
          return compareCards(test, currentSuit!, trumpSuit) === test.length - 1;
        });

        if (onTeam) {
          const currentBest = compareCards(alreadyPlayed, currentSuit!, trumpSuit);
          const bestSeat = played[currentBest]?.seat;
          if (bestSeat === seat1 || bestSeat === seat2) {
            chosen = lowestCard(validCards); // teammate winning → duck
          } else {
            chosen = winning.length > 0 ? lowestCard(winning) : lowestCard(validCards);
          }
        } else {
          chosen = winning.length > 0 ? lowestCard(winning) : lowestCard(validCards);
        }
      }

      // Remove chosen card from simulated hand
      const [val, suit] = chosen.split(' ');
      const idx = hands[s][suit as Suit].indexOf(val);
      if (idx >= 0) hands[s][suit as Suit].splice(idx, 1);

      if (!trumpBroken && suit === trumpSuit && currentSuit !== trumpSuit) {
        trumpBroken = true;
      }
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

// ---------------------------------------------------------------------------
// God Bot Bidding
// ---------------------------------------------------------------------------

/**
 * Choose the best bid for the God Bot at `seat`.
 *
 * Iterates over all possible partners, runs a trick-estimate simulation for
 * each pairing, selects the partner that yields the most tricks, and bids
 * as high as the simulation supports (up to MAX_BID).
 *
 * Returns null (pass) if no viable team can be found.
 */
export function getGodBotBid(state: GameState, seat: number): number | null {
  const myHand = state.hands[seat];
  const myPoints = getHandPoints(myHand);

  if (myPoints < 10) return null;

  let bestPartnerSeat = -1;
  let bestTeamTricks = 0;
  let bestSuitIdx = 4; // default: no-trump

  for (let p = 0; p < NUM_PLAYERS; p++) {
    if (p === seat) continue;
    const partnerPoints = getHandPoints(state.hands[p]);
    const combinedPoints = myPoints + partnerPoints;
    if (combinedPoints < 20) continue;

    // Best trump suit = highest combined card count; tiebreak by combined HCP
    let teamBestSuitIdx = 4;
    let teamBestLen = 0;
    let teamBestHCP = 0;
    for (let si = 0; si < CARD_SUITS.length; si++) {
      const suit = CARD_SUITS[si];
      const teamLen = myHand[suit].length + state.hands[p][suit].length;
      const teamHCP = [...myHand[suit], ...state.hands[p][suit]].reduce(
        (acc, v) => acc + (v === 'A' ? 4 : v === 'K' ? 3 : v === 'Q' ? 2 : v === 'J' ? 1 : 0),
        0,
      );
      if (teamLen > teamBestLen || (teamLen === teamBestLen && teamHCP > teamBestHCP)) {
        teamBestLen = teamLen;
        teamBestHCP = teamHCP;
        teamBestSuitIdx = si;
      }
    }
    if (teamBestLen < 5) teamBestSuitIdx = 4; // no strong fit → prefer no-trump

    const estimatedTricks = estimateTricksForPair(state, seat, p, BID_SUITS[teamBestSuitIdx]);
    const level = combinedPoints >= 28 ? 3 : combinedPoints >= 24 ? 2 : 1;
    const setsNeeded = level + 6;

    if (estimatedTricks >= setsNeeded && estimatedTricks > bestTeamTricks) {
      bestTeamTricks = estimatedTricks;
      bestPartnerSeat = p;
      bestSuitIdx = teamBestSuitIdx;
    }
  }

  if (bestPartnerSeat < 0) return null;

  const maxLevel = Math.min(7, bestTeamTricks - 6);
  if (maxLevel < 1) return null;

  for (let lvl = maxLevel; lvl >= 1; lvl--) {
    // Try preferred suit first, then escalate to no-trump if blocked by current bid
    for (let delta = 0; delta <= 4 - bestSuitIdx; delta++) {
      const si = bestSuitIdx + delta;
      const bidNum = (lvl - 1) * 5 + si;
      if (bidNum > state.bid && bidNum <= MAX_BID) return bidNum;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// God Bot Partner Selection
// ---------------------------------------------------------------------------

/**
 * Choose the partner card for the God Bot bidder at `bidderSeat`.
 *
 * Finds the partner with the highest combined trick-winning potential,
 * then selects the highest card in that partner's hand the bidder doesn't hold.
 * Trump suit is prioritised; falls back through ♠ ♥ ♦ ♣.
 */
export function getGodBotPartnerCard(state: GameState, bidderSeat: number): string {
  const myHand = state.hands[bidderSeat];
  const myPoints = getHandPoints(myHand);

  let bestPartnerSeat = -1;
  let bestTeamTricks = 0;

  for (let p = 0; p < NUM_PLAYERS; p++) {
    if (p === bidderSeat) continue;
    const combinedPoints = myPoints + getHandPoints(state.hands[p]);
    if (combinedPoints < 18) continue;
    const estimated = estimateTricksForPair(state, bidderSeat, p, state.trumpSuit);
    if (estimated > bestTeamTricks) {
      bestTeamTricks = estimated;
      bestPartnerSeat = p;
    }
  }

  // Fallback: pick the seat with the most HCP
  if (bestPartnerSeat < 0) {
    let maxPts = -1;
    for (let p = 0; p < NUM_PLAYERS; p++) {
      if (p === bidderSeat) continue;
      const pts = getHandPoints(state.hands[p]);
      if (pts > maxPts) { maxPts = pts; bestPartnerSeat = p; }
    }
  }

  const partnerHand = state.hands[bestPartnerSeat];
  const VALUES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

  // Try trump suit first, then ♠ ♥ ♦ ♣
  const suitsToTry: Suit[] = [];
  if (state.trumpSuit && state.trumpSuit !== '🚫') {
    suitsToTry.push(state.trumpSuit as Suit);
  }
  for (const suit of ['♠', '♥', '♦', '♣'] as Suit[]) {
    if (!suitsToTry.includes(suit)) suitsToTry.push(suit);
  }

  for (const suit of suitsToTry) {
    const partnerHolds = new Set(partnerHand[suit]);
    const bidderHolds = new Set(myHand[suit]);
    for (const value of VALUES) {
      if (partnerHolds.has(value) && !bidderHolds.has(value)) {
        return `${value} ${suit}`;
      }
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
// God Bot Card Play
// ---------------------------------------------------------------------------

/**
 * Choose the card to play for the God Bot at `seat`.
 * Dispatches to lead or follow logic based on whether a trick is in progress.
 */
export function getGodBotCard(state: GameState, seat: number): string {
  const hand = state.hands[seat];
  const validSuits = getValidSuits(hand, state.trumpSuit, state.currentSuit, state.trumpBroken);
  if (validSuits.length === 0) return '';

  const validCards: string[] = [];
  for (const suit of validSuits) {
    for (const value of hand[suit]) validCards.push(`${value} ${suit}`);
  }
  if (validCards.length === 0) return '';

  const trickInProgress = !state.trickComplete && state.playedCards.some((c) => c !== null);
  const onTeam = isOnBidderTeam(state, seat);

  if (!trickInProgress) {
    return godBotLead(state, seat, validCards, onTeam);
  }
  return onTeam
    ? godBotFollowBidderTeam(state, seat, validCards)
    : godBotFollowOpposition(state, seat, validCards);
}

/**
 * Lead selection: no cards on the table yet this trick.
 *
 * Bidder team: lead highest card in the suit where the partner's holding is deepest/strongest.
 * Opposition: lead highest card in the suit where bidder+partner are combined weakest.
 */
export function godBotLead(
  state: GameState,
  seat: number,
  validCards: string[],
  onBidderTeam: boolean,
): string {
  const trumpSuit = state.trumpSuit;

  if (onBidderTeam) {
    const partnerSeat = seat === state.bidder ? state.partner : state.bidder;
    if (partnerSeat >= 0) {
      const partnerHand = state.hands[partnerSeat];
      let bestSuit: Suit | null = null;
      let bestScore = -1;
      for (const suit of CARD_SUITS) {
        if (suit === trumpSuit) continue;
        const mySuitCards = validCards.filter((c) => c.split(' ')[1] === suit);
        if (mySuitCards.length === 0) continue;
        const partnerLen = partnerHand[suit].length;
        const partnerTopVal = partnerLen > 0 ? getNumFromValue(partnerHand[suit][0]) : 0;
        const score = partnerLen * 10 + partnerTopVal;
        if (score > bestScore) { bestScore = score; bestSuit = suit; }
      }
      if (bestSuit) {
        const suitCards = validCards.filter((c) => c.split(' ')[1] === bestSuit);
        if (suitCards.length > 0) return highestCard(suitCards);
      }
    }
    return leadStrongestNonTrump(state, seat, validCards, trumpSuit);
  } else {
    const bidderSeat = state.bidder;
    const partnerSeat = state.partner;
    let weakestSuit: Suit | null = null;
    let weakestScore = Infinity;

    for (const suit of CARD_SUITS) {
      if (suit === trumpSuit) continue;
      const mySuitCards = validCards.filter((c) => c.split(' ')[1] === suit);
      if (mySuitCards.length === 0) continue;
      const bidderLen = bidderSeat >= 0 ? state.hands[bidderSeat][suit].length : 0;
      const partnerLen = partnerSeat >= 0 ? state.hands[partnerSeat][suit].length : 0;
      const score = bidderLen + partnerLen;
      if (score < weakestScore) { weakestScore = score; weakestSuit = suit; }
    }

    if (weakestSuit) {
      const suitCards = validCards.filter((c) => c.split(' ')[1] === weakestSuit);
      if (suitCards.length > 0) return highestCard(suitCards);
    }

    const nonTrump = validCards.filter((c) => c.split(' ')[1] !== trumpSuit);
    return highestCard(nonTrump.length > 0 ? nonTrump : validCards);
  }
}

/**
 * Follow logic for the bidder's team (bidder or partner).
 *
 * - If a teammate is currently winning AND no opponent can beat it → duck (lowest card).
 * - Else play the cheapest winning card.
 * - If can't win → dump lowest non-trump (preserve trump).
 */
export function godBotFollowBidderTeam(
  state: GameState,
  seat: number,
  validCards: string[],
): string {
  const currentWinnerSeat = getCurrentTrickWinnerSeat(state);

  if (currentWinnerSeat !== null && isOnBidderTeam(state, currentWinnerSeat)) {
    const remaining = yetToPlay(state, seat);
    const opponentCanBeat = remaining
      .filter((s) => !isOnBidderTeam(state, s))
      .some((oppSeat) => {
        const oppHand = state.hands[oppSeat];
        const oppSuits = getValidSuits(oppHand, state.trumpSuit, state.currentSuit, state.trumpBroken);
        const oppCards: string[] = [];
        for (const suit of oppSuits) {
          for (const v of oppHand[suit]) oppCards.push(`${v} ${suit}`);
        }
        return oppCards.some((card) => {
          const test = [...getOrderedCardsPlayed(state), card];
          return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
        });
      });

    if (!opponentCanBeat) return lowestCard(validCards);
  }

  const winning = winningCards(state, validCards);
  if (winning.length > 0) return lowestCard(winning);

  const nonTrump = validCards.filter((c) => c.split(' ')[1] !== state.trumpSuit);
  return lowestCard(nonTrump.length > 0 ? nonTrump : validCards);
}

/**
 * Follow logic for the opposition.
 *
 * - If an opposition teammate is winning AND the bidder team can't beat it → duck.
 * - Else play cheapest winning card.
 * - If can't win → dump lowest non-trump (preserve trump for blocking).
 */
export function godBotFollowOpposition(
  state: GameState,
  seat: number,
  validCards: string[],
): string {
  const currentWinnerSeat = getCurrentTrickWinnerSeat(state);

  if (currentWinnerSeat !== null && !isOnBidderTeam(state, currentWinnerSeat)) {
    const remaining = yetToPlay(state, seat);
    const bidderTeamCanBeat = remaining
      .filter((s) => isOnBidderTeam(state, s))
      .some((btSeat) => {
        const btHand = state.hands[btSeat];
        const btSuits = getValidSuits(btHand, state.trumpSuit, state.currentSuit, state.trumpBroken);
        const btCards: string[] = [];
        for (const suit of btSuits) {
          for (const v of btHand[suit]) btCards.push(`${v} ${suit}`);
        }
        return btCards.some((card) => {
          const test = [...getOrderedCardsPlayed(state), card];
          return compareCards(test, state.currentSuit!, state.trumpSuit) === test.length - 1;
        });
      });

    if (!bidderTeamCanBeat) return lowestCard(validCards);
  }

  const winning = winningCards(state, validCards);
  if (winning.length > 0) return lowestCard(winning);

  const nonTrump = validCards.filter((c) => c.split(' ')[1] !== state.trumpSuit);
  return lowestCard(nonTrump.length > 0 ? nonTrump : validCards);
}

// ---------------------------------------------------------------------------
// Internal helper (also exported for testing)
// ---------------------------------------------------------------------------

/**
 * Lead the highest card from the seat's own longest/strongest non-trump suit.
 */
export function leadStrongestNonTrump(
  state: GameState,
  seat: number,
  validCards: string[],
  trumpSuit: BidSuit | null,
): string {
  const hand = state.hands[seat];
  let bestSuit: Suit | null = null;
  let bestScore = -1;
  for (const suit of CARD_SUITS) {
    if (suit === trumpSuit) continue;
    const len = hand[suit].length;
    const topVal = len > 0 ? getNumFromValue(hand[suit][0]) : 0; // hand sorted descending
    const score = len * 10 + topVal;
    if (score > bestScore) { bestScore = score; bestSuit = suit; }
  }
  if (bestSuit) {
    const suitCards = validCards.filter((c) => c.split(' ')[1] === bestSuit);
    if (suitCards.length > 0) return highestCard(suitCards);
  }
  return highestCard(validCards);
}
