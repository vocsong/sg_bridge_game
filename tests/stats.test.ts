import { describe, it, expect } from 'vitest';
import { getWinnerSeats } from '../src/stats';

describe('getWinnerSeats', () => {
  it('returns bidder and partner seats when bidder wins', () => {
    expect(getWinnerSeats(0, 2, true)).toEqual([0, 2]);
  });

  it('returns opponent seats when bidder loses', () => {
    expect(getWinnerSeats(0, 2, false)).toEqual([1, 3]);
  });

  it('returns only bidder seat when partner === bidder and bidder wins', () => {
    expect(getWinnerSeats(1, 1, true)).toEqual([1]);
  });

  it('returns all three opponents when partner === bidder and bidder loses', () => {
    expect(getWinnerSeats(1, 1, false)).toEqual([0, 2, 3]);
  });

  it('handles different seat positions', () => {
    expect(getWinnerSeats(3, 1, true)).toEqual([3, 1]);
    expect(getWinnerSeats(3, 1, false)).toEqual([0, 2]);
  });
});
