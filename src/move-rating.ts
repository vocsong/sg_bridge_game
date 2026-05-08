import type { Hand, Suit, BidSuit } from './types';
import { CARD_SUITS } from './types';
import { compareCards, getValidSuits, getNumFromValue } from './bridge';

export interface RateGameInput {
  bidderSeat: number;
  trumpSuit: string | null;
  partnerCard: string;
  initialHands: Hand[];
  trickLog: { trickNum: number; playOrder: number; seat: number; card: string }[];
}

export type RatingLabel = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveRating {
  trickNum: number;
  playOrder: number;
  seat: number;
  card: string;
  rating: RatingLabel;
  reason: string;
}

export interface RatingSummary {
  best: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
}

type Team = 'bidder' | 'opposition';
type TeamView = Team | 'unknown';

interface PlayCtx {
  trickNum: number;
  playOrder: number;
  seat: number;
  card: string;
  handAtPlay: Hand;                  // includes the card about to be played
  allHandsAtPlay: Hand[];            // full 4-hand state at play time (duo-vs-duo evaluation)
  trickCardsSoFar: string[];
  trickSeatsSoFar: number[];
  remainingTrickSeats: number[];     // seats that still play after this move, in play order
  trumpSuit: BidSuit | null;
  trumpBroken: boolean;
  bidderSeat: number;
  partnerCard: string;
  partnerSeat: number;               // actual partner seat derived from initial hands
  partnerCardPlayed: boolean;        // public reveal: partner card has been played
}

function parseCard(card: string): { value: string; suit: Suit; num: number } {
  const i = card.lastIndexOf(' ');
  const value = card.slice(0, i);
  const suit = card.slice(i + 1) as Suit;
  return { value, suit, num: getNumFromValue(value) };
}

function cloneHand(h: Hand): Hand {
  return { '♣': [...h['♣']], '♦': [...h['♦']], '♥': [...h['♥']], '♠': [...h['♠']] };
}

function removeCard(hand: Hand, card: string): void {
  const { value, suit } = parseCard(card);
  const idx = hand[suit].indexOf(value);
  if (idx >= 0) hand[suit].splice(idx, 1);
}

function isTrump(cardSuit: Suit, trumpSuit: BidSuit | null): boolean {
  return !!(trumpSuit && trumpSuit !== '🚫' && cardSuit === trumpSuit);
}

function suitValuesDesc(hand: Hand, suit: Suit): string[] {
  return [...hand[suit]].sort((a, b) => getNumFromValue(b) - getNumFromValue(a));
}

function findInitialPartnerSeat(hands: Hand[], partnerCard: string): number {
  const i = partnerCard.lastIndexOf(' ');
  if (i <= 0) return -1;
  const value = partnerCard.slice(0, i);
  const suit = partnerCard.slice(i + 1) as Suit;
  if (!CARD_SUITS.includes(suit)) return -1;
  for (let s = 0; s < hands.length; s++) {
    if ((hands[s][suit] || []).includes(value)) return s;
  }
  return -1;
}

function actualTeam(seat: number, bidderSeat: number, partnerSeat: number): Team {
  return seat === bidderSeat || seat === partnerSeat ? 'bidder' : 'opposition';
}

/**
 * How does `observer` perceive `target`'s team at the moment of play?
 * Models the private/public knowledge state for partner identity:
 *  - Bidder is public (everyone always knows).
 *  - Partner holds the partner card → they privately know from trick 1.
 *  - Everyone else only learns partner identity when the partner card is played.
 */
function perceivedTeam(
  observer: number,
  target: number,
  bidderSeat: number,
  partnerSeat: number,
  partnerCardPlayed: boolean,
): TeamView {
  if (target === observer) return actualTeam(observer, bidderSeat, partnerSeat);
  if (target === bidderSeat) return 'bidder';
  const observerKnowsPartner = observer === partnerSeat || partnerCardPlayed;
  return observerKnowsPartner ? actualTeam(target, bidderSeat, partnerSeat) : 'unknown';
}

function observerKnowsTeammate(
  seat: number, bidderSeat: number, partnerSeat: number, partnerCardPlayed: boolean,
): boolean {
  if (seat === partnerSeat) return true;                 // partner always knows (privately)
  return partnerCardPlayed;                              // others only post-reveal
}

function teammateSeat(seat: number, bidderSeat: number, partnerSeat: number): number {
  if (seat === bidderSeat) return partnerSeat;
  if (seat === partnerSeat) return bidderSeat;
  for (let s = 0; s < 4; s++) {
    if (s !== seat && s !== bidderSeat && s !== partnerSeat) return s;
  }
  return -1;
}

/**
 * Duo-vs-duo check: will the observer's known teammate, still to play in this trick,
 * be able to take the trick? If yes, the observer can safely play low instead of winning.
 * Gated on observer actually knowing their teammate.
 */
function teammateCanWinTrick(
  ctx: PlayCtx,
  leadSuit: Suit,
  winner: { value: string; suit: Suit; num: number },
): boolean {
  const { seat, bidderSeat, partnerSeat, partnerCardPlayed, trumpSuit, allHandsAtPlay, remainingTrickSeats } = ctx;
  if (!observerKnowsTeammate(seat, bidderSeat, partnerSeat, partnerCardPlayed)) return false;
  const mate = teammateSeat(seat, bidderSeat, partnerSeat);
  if (mate < 0 || mate === seat) return false;
  if (!remainingTrickSeats.includes(mate)) return false;
  const mh = allHandsAtPlay[mate];
  if (!mh) return false;

  const winnerIsTrump = isTrump(winner.suit, trumpSuit);
  const mateHasLeadSuit = (mh[leadSuit] || []).length > 0;

  if (mateHasLeadSuit) {
    if (winnerIsTrump) return false;
    return (mh[leadSuit] || []).some((v) => getNumFromValue(v) > winner.num);
  }
  // Teammate void in lead suit → can they trump?
  if (!trumpSuit || trumpSuit === '🚫') return false;
  const trumpsHeld = mh[trumpSuit as Suit] || [];
  if (trumpsHeld.length === 0) return false;
  if (!winnerIsTrump) return true;
  return trumpsHeld.some((v) => getNumFromValue(v) > winner.num);
}

function rateLead(ctx: PlayCtx): MoveRating {
  const { card, handAtPlay, trumpSuit, trumpBroken, seat, bidderSeat, partnerSeat } = ctx;
  const p = parseCard(card);
  const effectiveTrump: Suit | null = (trumpSuit && trumpSuit !== '🚫') ? (trumpSuit as Suit) : null;
  const playedTrump = effectiveTrump ? p.suit === effectiveTrump : false;
  // Partner knows their team from trick 1 (they hold the partner card privately).
  const onBidderTeam = seat === bidderSeat || seat === partnerSeat;

  if (playedTrump && !trumpBroken) {
    const legal = getValidSuits(handAtPlay, trumpSuit, null, trumpBroken);
    const forced = legal.length === 1 && effectiveTrump !== null && legal[0] === effectiveTrump;
    if (!forced) {
      return baseRating(ctx, 'blunder', 'Led trump before it was broken');
    }
  }

  if (!onBidderTeam && playedTrump) {
    return baseRating(ctx, 'inaccuracy', 'Led trump — helps the bidder clear trumps');
  }

  // Lead-from-length heuristic: prefer longest non-trump suit.
  let longestSuit: Suit | null = null;
  let longestLen = 0;
  for (const s of CARD_SUITS) {
    if (effectiveTrump && s === effectiveTrump) continue;
    if (handAtPlay[s].length > longestLen) {
      longestLen = handAtPlay[s].length;
      longestSuit = s;
    }
  }
  if (longestSuit && p.suit === longestSuit && longestLen >= 4) {
    return baseRating(ctx, 'best', `Led from length (${longestLen} card ${longestSuit})`);
  }
  if (longestSuit && p.suit === longestSuit) {
    return baseRating(ctx, 'good', 'Led the longest non-trump suit');
  }
  return baseRating(ctx, 'good', 'Reasonable lead');
}

function rateFollow(ctx: PlayCtx): MoveRating {
  const { card, handAtPlay, trickCardsSoFar, trickSeatsSoFar, trumpSuit, seat, bidderSeat, partnerSeat, partnerCardPlayed } = ctx;
  const p = parseCard(card);
  const leadCard = trickCardsSoFar[0];
  const leadSuit = parseCard(leadCard).suit;
  const winnerIdx = compareCards(trickCardsSoFar, leadSuit, trumpSuit);
  const winnerSeat = trickSeatsSoFar[winnerIdx];
  const winnerCard = trickCardsSoFar[winnerIdx];
  const winner = parseCard(winnerCard);

  const myTeam = perceivedTeam(seat, seat, bidderSeat, partnerSeat, partnerCardPlayed);
  const winnerTeam = perceivedTeam(seat, winnerSeat, bidderSeat, partnerSeat, partnerCardPlayed);
  const winnerOnMyTeam =
    myTeam !== 'unknown' && winnerTeam !== 'unknown' && myTeam === winnerTeam;

  const mustFollow = handAtPlay[leadSuit].length > 0;

  if (mustFollow) {
    return rateFollowingSuit(ctx, leadSuit, winner, winnerOnMyTeam);
  }
  return rateNotFollowing(ctx, leadSuit, winner, winnerOnMyTeam);
}

function rateFollowingSuit(
  ctx: PlayCtx,
  leadSuit: Suit,
  winner: { value: string; suit: Suit; num: number },
  winnerOnMyTeam: boolean,
): MoveRating {
  const { card, handAtPlay, trumpSuit } = ctx;
  const p = parseCard(card);
  const mySuit = suitValuesDesc(handAtPlay, leadSuit);

  const winnerIsTrump = isTrump(winner.suit, trumpSuit);
  const beatingValues: string[] = [];
  if (!winnerIsTrump && winner.suit === leadSuit) {
    for (const v of mySuit) {
      if (getNumFromValue(v) > winner.num) beatingValues.push(v);
    }
  }
  const canBeat = beatingValues.length > 0;
  const lowestInSuit = mySuit[mySuit.length - 1];

  if (winnerOnMyTeam) {
    if (p.value === lowestInSuit) {
      return baseRating(ctx, 'best', 'Partner winning — dumped lowest in suit');
    }
    if (canBeat && beatingValues.includes(p.value)) {
      return baseRating(ctx, 'blunder', 'Overtook partner\'s winning card');
    }
    return baseRating(ctx, 'inaccuracy', 'Partner winning — could have dumped a lower card');
  }

  // Opponent winning (or team unknown — default to playing for the trick).
  if (canBeat) {
    const lowestWinner = beatingValues[beatingValues.length - 1];
    if (p.value === lowestWinner) {
      return baseRating(ctx, 'best', 'Won the trick with the smallest sufficient card');
    }
    if (beatingValues.includes(p.value)) {
      return baseRating(ctx, 'good', 'Won the trick (a smaller winner was available)');
    }
    // Had a winner but played a loser — only a mistake if a known teammate can't cover.
    if (teammateCanWinTrick(ctx, leadSuit, winner)) {
      return baseRating(ctx, 'good', 'Left the trick for your partner to win');
    }
    return baseRating(ctx, 'mistake', 'Could have won the trick');
  }

  // Can't win by following. Dump lowest.
  if (p.value === lowestInSuit) {
    return baseRating(ctx, 'best', 'Can\'t beat the winner — dumped lowest');
  }
  const diff = p.num - getNumFromValue(lowestInSuit);
  if (diff >= 6) return baseRating(ctx, 'inaccuracy', 'Wasted a high card on a trick you couldn\'t win');
  return baseRating(ctx, 'good', 'Reasonable discard');
}

function rateNotFollowing(
  ctx: PlayCtx,
  leadSuit: Suit,
  winner: { value: string; suit: Suit; num: number },
  winnerOnMyTeam: boolean,
): MoveRating {
  const { card, handAtPlay, trumpSuit } = ctx;
  const p = parseCard(card);
  const effectiveTrump: Suit | null = (trumpSuit && trumpSuit !== '🚫') ? (trumpSuit as Suit) : null;
  const haveTrump = effectiveTrump !== null && handAtPlay[effectiveTrump].length > 0;
  const playedTrump = effectiveTrump !== null && p.suit === effectiveTrump;

  if (playedTrump) {
    if (winnerOnMyTeam) {
      return baseRating(ctx, 'blunder', 'Trumped your partner\'s winning trick');
    }
    const winnerIsTrump = isTrump(winner.suit, trumpSuit);
    if (winnerIsTrump) {
      if (p.num > winner.num) {
        const myTrumps = suitValuesDesc(handAtPlay, effectiveTrump!);
        const overtrumps = myTrumps.filter((v) => getNumFromValue(v) > winner.num);
        const lowestOver = overtrumps[overtrumps.length - 1];
        if (p.value === lowestOver) {
          return baseRating(ctx, 'best', 'Overtrumped with the smallest sufficient trump');
        }
        return baseRating(ctx, 'good', 'Overtrumped (a smaller trump was available)');
      }
      return baseRating(ctx, 'mistake', 'Played a trump that didn\'t beat the current trump');
    }
    const myTrumps = suitValuesDesc(handAtPlay, effectiveTrump!);
    const lowestTrump = myTrumps[myTrumps.length - 1];
    if (p.value === lowestTrump) {
      return baseRating(ctx, 'best', 'Trumped in with your lowest trump');
    }
    return baseRating(ctx, 'good', 'Trumped in (a smaller trump was available)');
  }

  // Discarded off-suit non-trump.
  if (winnerOnMyTeam) {
    let lowestOff: { value: string; suit: Suit; num: number } | null = null;
    for (const s of CARD_SUITS) {
      if (effectiveTrump && s === effectiveTrump) continue;
      for (const v of handAtPlay[s]) {
        const n = getNumFromValue(v);
        if (!lowestOff || n < lowestOff.num) lowestOff = { value: v, suit: s, num: n };
      }
    }
    if (lowestOff && p.value === lowestOff.value && p.suit === lowestOff.suit) {
      return baseRating(ctx, 'best', 'Partner winning — dumped your lowest card');
    }
    return baseRating(ctx, 'good', 'Partner winning — dumped off-suit');
  }

  // Opponent winning (or unknown). If I had a trump, I could have grabbed the trick —
  // unless a known teammate will take it.
  if (haveTrump) {
    if (teammateCanWinTrick(ctx, leadSuit, winner)) {
      return baseRating(ctx, 'good', 'Conserved trump — partner can take this trick');
    }
    return baseRating(ctx, 'mistake', 'Could have trumped to win this trick');
  }
  return baseRating(ctx, 'good', 'No trump available — discarded off-suit');
}

function baseRating(ctx: PlayCtx, rating: RatingLabel, reason: string): MoveRating {
  return {
    trickNum: ctx.trickNum,
    playOrder: ctx.playOrder,
    seat: ctx.seat,
    card: ctx.card,
    rating,
    reason,
  };
}

/**
 * Rate every play in a completed game.
 *
 * Duo-aware heuristic engine:
 *  - The rating uses the player's actual knowledge at play time. The partner (who holds the
 *    partner card) knows the bidder is their teammate from trick 1; bidder and opposition
 *    only learn partner identity once the partner card is played publicly.
 *  - Pre-reveal ambiguity is captured by a 'unknown' team view; the engine falls back to
 *    "play for the trick" in those cases (same as the bidder's default attitude).
 *  - For duo-level evaluation, the engine also looks across all four hands to check whether
 *    the observer's KNOWN teammate can still take the trick. If so, playing low instead of
 *    winning is scored as 'good' rather than a mistake.
 */
export function rateGame(replay: RateGameInput): MoveRating[] {
  const ratings: MoveRating[] = [];
  const hands = replay.initialHands.map(cloneHand);
  const partnerSeat = findInitialPartnerSeat(replay.initialHands, replay.partnerCard);
  let trumpBroken = false;
  let partnerCardPlayed = false;

  const byTrick = new Map<number, { trickNum: number; playOrder: number; seat: number; card: string }[]>();
  for (const e of replay.trickLog) {
    if (!byTrick.has(e.trickNum)) byTrick.set(e.trickNum, []);
    byTrick.get(e.trickNum)!.push(e);
  }
  const sortedTricks = [...byTrick.keys()].sort((a, b) => a - b);

  for (const tn of sortedTricks) {
    const plays = byTrick.get(tn)!.sort((a, b) => a.playOrder - b.playOrder);
    const trickCardsSoFar: string[] = [];
    const trickSeatsSoFar: number[] = [];

    for (let pi = 0; pi < plays.length; pi++) {
      const play = plays[pi];
      const remainingTrickSeats = plays.slice(pi + 1).map((p) => p.seat);
      const ctx: PlayCtx = {
        trickNum: play.trickNum,
        playOrder: play.playOrder,
        seat: play.seat,
        card: play.card,
        handAtPlay: hands[play.seat],
        allHandsAtPlay: hands,
        trickCardsSoFar: [...trickCardsSoFar],
        trickSeatsSoFar: [...trickSeatsSoFar],
        remainingTrickSeats,
        trumpSuit: replay.trumpSuit as BidSuit | null,
        trumpBroken,
        bidderSeat: replay.bidderSeat,
        partnerCard: replay.partnerCard,
        partnerSeat,
        partnerCardPlayed,
      };

      const rating = play.playOrder === 1 ? rateLead(ctx) : rateFollow(ctx);
      ratings.push(rating);

      trickCardsSoFar.push(play.card);
      trickSeatsSoFar.push(play.seat);
      removeCard(hands[play.seat], play.card);
      if (isTrump(parseCard(play.card).suit, replay.trumpSuit as BidSuit | null)) {
        trumpBroken = true;
      }
      if (play.card === replay.partnerCard && !partnerCardPlayed) {
        partnerCardPlayed = true;
      }
    }
  }

  return ratings;
}

export function summarize(ratings: MoveRating[]): RatingSummary {
  const s: RatingSummary = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  for (const r of ratings) s[r.rating]++;
  return s;
}
