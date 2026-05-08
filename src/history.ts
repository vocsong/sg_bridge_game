import type { D1Database } from '@cloudflare/workers-types';
import type { Suit, BidSuit, Hand, BidHistoryEntry } from './types';
import { CARD_SUITS, BID_SUITS } from './types';
import { compareCards, getNumFromValue } from './bridge';
import { rateGame, summarize, type MoveRating, type RatingSummary } from './move-rating';

export interface GameListItem {
  gameId: string;
  playedAt: number;
  role: 'bidder' | 'partner' | 'opposition';
  won: boolean;
  bidLevel: number;
  bidSuit: string;
  trumpSuit: string | null;
  tricksWon: number;
  setsNeeded: number;
  bidderSeat: number;
  seatMap: { seat: number; name: string }[];
  isPractice: boolean;
}

export interface GameReplay {
  gameId: string;
  playedAt: number;
  bidderSeat: number;
  bid: number;
  bidLevel: number;
  bidSuit: string;
  trumpSuit: string | null;
  partnerCard: string;
  bidHistory: BidHistoryEntry[];
  seatMap: { seat: number; name: string }[];
  tricksWon: number[];
  winningTeam: 'bidder' | 'opponents';
  initialHands: Hand[];
  finalHands: (Hand | null)[];
  trickLog: { trickNum: number; playOrder: number; seat: number; card: string }[];
  trickWinners: number[];
  ratings: MoveRating[];
  ratingSummary: RatingSummary;
  isPractice: boolean;
}

function cardsToHand(cards: string[]): Hand {
  const hand: Hand = { '♣': [], '♦': [], '♥': [], '♠': [] };
  for (const c of cards) {
    const i = c.lastIndexOf(' ');
    if (i <= 0) continue;
    const value = c.slice(0, i);
    const suit = c.slice(i + 1) as Suit;
    if (!CARD_SUITS.includes(suit)) continue;
    hand[suit].push(value);
  }
  for (const s of CARD_SUITS) {
    hand[s].sort((a, b) => getNumFromValue(b) - getNumFromValue(a));
  }
  return hand;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Determine which seat holds the partner card in their initial hand.
 * Returns -1 if not found (shouldn't happen for valid games).
 */
function findPartnerSeat(initialHands: Hand[], partnerCard: string): number {
  const i = partnerCard.lastIndexOf(' ');
  if (i <= 0) return -1;
  const value = partnerCard.slice(0, i);
  const suit = partnerCard.slice(i + 1) as Suit;
  for (let seat = 0; seat < initialHands.length; seat++) {
    if (initialHands[seat]?.[suit]?.includes(value)) return seat;
  }
  return -1;
}

/**
 * Returns up to `limit` games the authenticated user played in (including practice games),
 * most recent first. Practice games are flagged via `isPractice`.
 * If `before` is supplied, returns games older than that unix timestamp (keyset pagination).
 */
export async function listUserGames(
  db: D1Database,
  telegramId: number,
  limit: number,
  before: number | null,
): Promise<GameListItem[]> {
  const beforeClause = before !== null ? 'AND gm.played_at < ?' : '';
  const binds: (string | number)[] = [telegramId];
  if (before !== null) binds.push(before);
  binds.push(limit);

  // game_hands is our per-user participation index (written for all games, practice + rated).
  // One row per (game_id, seat); filtering by telegram_id picks out the user's seat.
  const rows = await db
    .prepare(
      `SELECT gh.game_id, gh.seat AS user_seat, gh.initial_hand AS user_initial_hand,
              gm.played_at, gm.bidder_seat, gm.bid_num, gm.trump_suit, gm.partner_card,
              gm.seat_map, gm.tricks_won, gm.winning_team, gm.is_practice
       FROM game_hands gh
       JOIN game_metadata gm ON gm.game_id = gh.game_id
       WHERE gh.telegram_id = ? ${beforeClause}
       ORDER BY gm.played_at DESC
       LIMIT ?`,
    )
    .bind(...binds)
    .all<{
      game_id: string;
      user_seat: number;
      user_initial_hand: string;
      played_at: number;
      bidder_seat: number;
      bid_num: number;
      trump_suit: string | null;
      partner_card: string;
      seat_map: string;
      tricks_won: string;
      winning_team: 'bidder' | 'opponents';
      is_practice: number;
    }>();

  // To derive role (partner vs opposition) we need to know who held the partner card.
  // Fetch initial_hand for every row's game from game_hands and figure it out per-row.
  const gameIds = (rows.results ?? []).map((r) => r.game_id);
  const partnerSeatByGame = new Map<string, number>();
  if (gameIds.length > 0) {
    const placeholders = gameIds.map(() => '?').join(',');
    const handsRows = await db
      .prepare(
        `SELECT game_id, seat, initial_hand FROM game_hands
         WHERE game_id IN (${placeholders})`,
      )
      .bind(...gameIds)
      .all<{ game_id: string; seat: number; initial_hand: string }>();

    // Build initial hands by game, then locate partner seat.
    const handsByGame = new Map<string, Hand[]>();
    for (const h of handsRows.results ?? []) {
      if (!handsByGame.has(h.game_id)) {
        handsByGame.set(h.game_id, [
          { '♣': [], '♦': [], '♥': [], '♠': [] },
          { '♣': [], '♦': [], '♥': [], '♠': [] },
          { '♣': [], '♦': [], '♥': [], '♠': [] },
          { '♣': [], '♦': [], '♥': [], '♠': [] },
        ]);
      }
      const arr = handsByGame.get(h.game_id)!;
      arr[h.seat] = cardsToHand(safeJson<string[]>(h.initial_hand, []));
    }
    for (const r of rows.results ?? []) {
      partnerSeatByGame.set(r.game_id, findPartnerSeat(handsByGame.get(r.game_id) ?? [], r.partner_card));
    }
  }

  return (rows.results ?? []).map((r) => {
    const sets = safeJson<number[]>(r.tricks_won, [0, 0, 0, 0]);
    const bidLevel = Math.floor(r.bid_num / 5) + 1;
    const bidSuit = BID_SUITS[r.bid_num % 5];
    const partnerSeat = partnerSeatByGame.get(r.game_id) ?? -1;
    const isSoloBidder = partnerSeat === r.bidder_seat || partnerSeat === -1;
    const bidderTeam = isSoloBidder ? [r.bidder_seat] : [r.bidder_seat, partnerSeat];
    const onBidderTeam = bidderTeam.includes(r.user_seat);

    let role: 'bidder' | 'partner' | 'opposition';
    if (r.user_seat === r.bidder_seat) role = 'bidder';
    else if (!isSoloBidder && r.user_seat === partnerSeat) role = 'partner';
    else role = 'opposition';

    const tricksWon = onBidderTeam
      ? bidderTeam.reduce((s, seat) => s + (sets[seat] ?? 0), 0)
      : [0, 1, 2, 3].filter((s) => !bidderTeam.includes(s)).reduce((s, seat) => s + (sets[seat] ?? 0), 0);

    const won = (r.winning_team === 'bidder') === onBidderTeam;

    return {
      gameId: r.game_id,
      playedAt: r.played_at,
      role,
      won,
      bidLevel,
      bidSuit,
      trumpSuit: r.trump_suit,
      tricksWon,
      setsNeeded: bidLevel + 6,
      bidderSeat: r.bidder_seat,
      seatMap: safeJson<{ seat: number; name: string }[]>(r.seat_map, []),
      isPractice: r.is_practice === 1,
    };
  });
}

/**
 * Returns a full replay payload for a completed game (including practice games),
 * or null if the caller did not participate or the game doesn't exist.
 * Authorization: caller must appear in game_hands for this gameId.
 */
export async function getGameReplay(
  db: D1Database,
  gameId: string,
  telegramId: number,
): Promise<GameReplay | null> {
  const authRow = await db
    .prepare('SELECT 1 AS ok FROM game_hands WHERE game_id = ? AND telegram_id = ? LIMIT 1')
    .bind(gameId, telegramId)
    .first<{ ok: number }>();
  if (!authRow) return null;

  const meta = await db
    .prepare(
      `SELECT bidder_seat, bid_num, trump_suit, partner_card, bid_history,
              seat_map, tricks_won, winning_team, played_at, is_practice
       FROM game_metadata WHERE game_id = ?`,
    )
    .bind(gameId)
    .first<{
      bidder_seat: number;
      bid_num: number;
      trump_suit: string | null;
      partner_card: string;
      bid_history: string;
      seat_map: string;
      tricks_won: string;
      winning_team: 'bidder' | 'opponents';
      played_at: number;
      is_practice: number;
    }>();
  if (!meta) return null;

  const handsRows = await db
    .prepare(
      `SELECT seat, initial_hand, final_hand
       FROM game_hands WHERE game_id = ? ORDER BY seat ASC`,
    )
    .bind(gameId)
    .all<{ seat: number; initial_hand: string; final_hand: string | null }>();

  const tricksRows = await db
    .prepare(
      `SELECT trick_num, play_order, seat, card
       FROM game_tricks WHERE game_id = ?
       ORDER BY trick_num ASC, play_order ASC`,
    )
    .bind(gameId)
    .all<{ trick_num: number; play_order: number; seat: number; card: string }>();

  const initialHands: Hand[] = [
    { '♣': [], '♦': [], '♥': [], '♠': [] },
    { '♣': [], '♦': [], '♥': [], '♠': [] },
    { '♣': [], '♦': [], '♥': [], '♠': [] },
    { '♣': [], '♦': [], '♥': [], '♠': [] },
  ];
  const finalHands: (Hand | null)[] = [null, null, null, null];
  for (const row of handsRows.results ?? []) {
    const init = safeJson<string[]>(row.initial_hand, []);
    initialHands[row.seat] = cardsToHand(init);
    if (row.final_hand) {
      const fin = safeJson<string[]>(row.final_hand, []);
      finalHands[row.seat] = cardsToHand(fin);
    }
  }

  const trickLog = (tricksRows.results ?? []).map((r) => ({
    trickNum: r.trick_num,
    playOrder: r.play_order,
    seat: r.seat,
    card: r.card,
  }));

  const trickWinners: number[] = [];
  const byTrick = new Map<number, { trickNum: number; playOrder: number; seat: number; card: string }[]>();
  for (const e of trickLog) {
    if (!byTrick.has(e.trickNum)) byTrick.set(e.trickNum, []);
    byTrick.get(e.trickNum)!.push(e);
  }
  const trumpSuit = (meta.trump_suit && BID_SUITS.includes(meta.trump_suit as BidSuit))
    ? (meta.trump_suit as BidSuit)
    : null;
  const sortedTrickNums = [...byTrick.keys()].sort((a, b) => a - b);
  for (const tn of sortedTrickNums) {
    const plays = byTrick.get(tn)!.sort((a, b) => a.playOrder - b.playOrder);
    if (plays.length === 0) continue;
    const cards = plays.map((p) => p.card);
    const leadSuit = cards[0].slice(cards[0].lastIndexOf(' ') + 1) as Suit;
    const winnerIdx = compareCards(cards, leadSuit, trumpSuit);
    trickWinners.push(plays[winnerIdx].seat);
  }

  const bidLevel = Math.floor(meta.bid_num / 5) + 1;
  const bidSuit = BID_SUITS[meta.bid_num % 5];

  const ratings = rateGame({
    bidderSeat: meta.bidder_seat,
    trumpSuit: meta.trump_suit,
    partnerCard: meta.partner_card,
    initialHands,
    trickLog,
  });

  return {
    gameId,
    playedAt: meta.played_at,
    bidderSeat: meta.bidder_seat,
    bid: meta.bid_num,
    bidLevel,
    bidSuit,
    trumpSuit: meta.trump_suit,
    partnerCard: meta.partner_card,
    bidHistory: safeJson<BidHistoryEntry[]>(meta.bid_history, []),
    seatMap: safeJson<{ seat: number; name: string }[]>(meta.seat_map, []),
    tricksWon: safeJson<number[]>(meta.tricks_won, [0, 0, 0, 0]),
    winningTeam: meta.winning_team,
    initialHands,
    finalHands,
    trickLog,
    trickWinners,
    ratings,
    ratingSummary: summarize(ratings),
    isPractice: meta.is_practice === 1,
  };
}
