import { parseCompareOffsetMicros } from 'utils/zincutils';

const DAY = 24 * 60 * 60 * 1_000_000;

describe('parseCompareOffsetMicros', () => {
  it('treats empty / zero / none as no offset', () => {
    expect(parseCompareOffsetMicros(undefined)).toBe(0);
    expect(parseCompareOffsetMicros(null)).toBe(0);
    expect(parseCompareOffsetMicros('')).toBe(0);
    expect(parseCompareOffsetMicros('   ')).toBe(0);
    expect(parseCompareOffsetMicros('0')).toBe(0);
    expect(parseCompareOffsetMicros('none')).toBe(0);
  });

  it('parses duration strings with units', () => {
    expect(parseCompareOffsetMicros('1s')).toBe(1_000_000);
    expect(parseCompareOffsetMicros('30m')).toBe(30 * 60 * 1_000_000);
    expect(parseCompareOffsetMicros('1h')).toBe(60 * 60 * 1_000_000);
    expect(parseCompareOffsetMicros('1d')).toBe(DAY);
    expect(parseCompareOffsetMicros('7d')).toBe(7 * DAY);
    expect(parseCompareOffsetMicros('1w')).toBe(7 * DAY);
  });

  it('is case insensitive and tolerates whitespace', () => {
    expect(parseCompareOffsetMicros(' 1D ')).toBe(DAY);
    expect(parseCompareOffsetMicros('7 D')).toBe(7 * DAY);
  });

  it('treats a bare integer as microseconds', () => {
    expect(parseCompareOffsetMicros('86400000000')).toBe(DAY);
    expect(parseCompareOffsetMicros(DAY)).toBe(DAY);
  });

  it('ignores invalid / non-positive input', () => {
    expect(parseCompareOffsetMicros('abc')).toBe(0);
    expect(parseCompareOffsetMicros('-1d')).toBe(0);
    expect(parseCompareOffsetMicros('1y')).toBe(0);
    expect(parseCompareOffsetMicros(-5)).toBe(0);
    expect(parseCompareOffsetMicros(NaN)).toBe(0);
  });
});
